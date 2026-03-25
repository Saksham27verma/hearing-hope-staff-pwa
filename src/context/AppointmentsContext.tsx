import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { collection, query, where, orderBy, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import type { Appointment } from '../types';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { getAppointmentsCache, setAppointmentsCache, addPendingSync } from '../services/offlineStorage';
import { processPendingSync } from '../services/syncEngine';

interface AppointmentsContextValue {
  appointments: Appointment[];
  loading: boolean;
  error: string | null;
  isOnline: boolean;
  refresh: () => void;
  updateAppointmentOptimistic: (id: string, patch: Partial<Appointment>) => void;
  markCompletedOffline: (id: string, feedback?: string) => void;
  markCancelledOffline: (id: string) => void;
}

const AppointmentsContext = createContext<AppointmentsContextValue | null>(null);

export function AppointmentsProvider({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId: string;
}) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isOnline } = useNetworkStatus();
  const uid = userId;
  const optimisticPatches = React.useRef<Map<string, Partial<Appointment>>>(new Map());

  const updateAppointmentOptimistic = useCallback(
    (id: string, patch: Partial<Appointment>) => {
      optimisticPatches.current.set(id, { ...optimisticPatches.current.get(id), ...patch });
      setAppointments((prev) => {
        const next = prev.map((a) => (a.id === id ? { ...a, ...patch } : a));
        void setAppointmentsCache(next, uid);
        return next;
      });
    },
    [uid]
  );

  const markCompletedOffline = useCallback(
    (id: string, feedback?: string) => {
      updateAppointmentOptimistic(id, { status: 'completed', feedback: feedback || '' });
      void addPendingSync({
        type: 'complete',
        appointmentId: id,
        payload: { status: 'completed', feedback: feedback || '' },
      });
    },
    [updateAppointmentOptimistic]
  );

  const markCancelledOffline = useCallback(
    (id: string) => {
      updateAppointmentOptimistic(id, { status: 'cancelled' });
      void addPendingSync({
        type: 'cancel',
        appointmentId: id,
        payload: { status: 'cancelled' },
      });
    },
    [updateAppointmentOptimistic]
  );

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
  }, []);

  useEffect(() => {
    if (!uid) {
      queueMicrotask(() => {
        setAppointments([]);
        setLoading(false);
      });
      return;
    }

    let mounted = true;
    let hasReceivedSnapshot = false;

    void getAppointmentsCache(uid).then((cached) => {
      if (mounted && !hasReceivedSnapshot && cached && cached.length > 0) {
        setAppointments(cached);
      }
      if (mounted && !hasReceivedSnapshot) setLoading(false);
    });

    const q = query(
      collection(db, 'appointments'),
      where('type', 'in', ['home', 'center']),
      orderBy('start', 'asc')
    );

    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        if (!mounted) return;
        hasReceivedSnapshot = true;
        let list: Appointment[] = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Appointment[];
        list = list.filter(
          (a) =>
            (a.type === 'home' && a.homeVisitorStaffId === uid) ||
            (a.type === 'center' && a.assignedStaffId === uid)
        );
        list.sort((a, b) => {
          const toStr = (s: unknown) => {
            if (!s) return '';
            if (typeof s === 'string') return s;
            const o = s as { toDate?: () => Date; seconds?: number };
            if (o?.toDate) return o.toDate().toISOString();
            if (typeof o?.seconds === 'number') return new Date(o.seconds * 1000).toISOString();
            return '';
          };
          return toStr(a.start).localeCompare(toStr(b.start));
        });

        const needCenterName = list.filter((a) => a.centerId && !a.centerName);
        if (needCenterName.length > 0) {
          const centersSnap = await getDocs(collection(db, 'centers'));
          const centerById: Record<string, string> = {};
          centersSnap.docs.forEach((d) => {
            const name = (d.data() as { name?: string })?.name;
            if (name) centerById[d.id] = name;
          });
          needCenterName.forEach((a) => {
            if (a.centerId && centerById[a.centerId]) {
              a.centerName = centerById[a.centerId];
            }
          });
        }

        if (mounted) {
          const patches = optimisticPatches.current;
          if (patches.size > 0) {
            list = list.map((a) => {
              const patch = patches.get(a.id);
              if (patch) {
                const merged = { ...a, ...patch };
                if (patch.status && a.status === patch.status) patches.delete(a.id);
                return merged;
              }
              return a;
            });
          }
          setAppointments(list);
          setLoading(false);
          setError(null);
          void setAppointmentsCache(list, uid);
        }
      },
      (err) => {
        if (!mounted) return;
        setError(err.message);
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [uid]);

  useEffect(() => {
    if (!isOnline) return;
    void processPendingSync();
  }, [isOnline]);

  const value: AppointmentsContextValue = {
    appointments,
    loading,
    error,
    isOnline,
    refresh,
    updateAppointmentOptimistic,
    markCompletedOffline,
    markCancelledOffline,
  };

  return <AppointmentsContext.Provider value={value}>{children}</AppointmentsContext.Provider>;
}

/** Hook for appointment state; colocated with provider for this app. */
// eslint-disable-next-line react-refresh/only-export-components -- hook + provider pattern
export function useAppointmentsContext() {
  const ctx = useContext(AppointmentsContext);
  if (!ctx) throw new Error('useAppointmentsContext must be used within AppointmentsProvider');
  return ctx;
}
