import type { Appointment } from '../types';

const CACHE_KEY_PREFIX = '@hearing_hope/appointments_cache';
const PENDING_SYNC_KEY = '@hearing_hope/pending_sync';

function getCacheKey(uid?: string): string {
  return uid ? `${CACHE_KEY_PREFIX}_${uid}` : CACHE_KEY_PREFIX;
}

export interface PendingSyncAction {
  id: string;
  type: 'complete' | 'cancel';
  appointmentId: string;
  payload: { status: string; feedback?: string };
  timestamp: number;
}

export async function getAppointmentsCache(uid?: string): Promise<Appointment[] | null> {
  try {
    const raw = localStorage.getItem(getCacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Appointment[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function setAppointmentsCache(appointments: Appointment[], uid?: string): Promise<void> {
  try {
    localStorage.setItem(getCacheKey(uid), JSON.stringify(appointments));
  } catch (e) {
    console.warn('Failed to cache appointments:', e);
  }
}

export async function getPendingSync(): Promise<PendingSyncAction[]> {
  try {
    const raw = localStorage.getItem(PENDING_SYNC_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingSyncAction[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function addPendingSync(action: Omit<PendingSyncAction, 'id' | 'timestamp'>): Promise<void> {
  try {
    const queue = await getPendingSync();
    const newAction: PendingSyncAction = {
      ...action,
      id: `sync_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
    };
    queue.push(newAction);
    localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(queue));
  } catch (e) {
    console.warn('Failed to add pending sync:', e);
  }
}

export async function removePendingSync(id: string): Promise<void> {
  try {
    const queue = await getPendingSync();
    const filtered = queue.filter((a) => a.id !== id);
    localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.warn('Failed to remove pending sync:', e);
  }
}
