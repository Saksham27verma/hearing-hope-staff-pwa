import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import {
  IoArrowBack,
  IoCall,
  IoCalendarOutline,
  IoTimeOutline,
  IoLocationOutline,
  IoOpenOutline,
  IoCheckmarkCircle,
  IoCloseCircleOutline,
  IoMedkitOutline,
} from 'react-icons/io5';
import { auth, db } from '../firebase';
import type { Appointment } from '../types';
import { theme } from '../theme';
import { useAppointmentsContext } from '../context/AppointmentsContext';
import { formatDateLong, formatTime, getStartForDisplay } from '../dateUtils';
import { isEligibleForVisitServicesLogging } from '../utils/appointmentPayable';
import styles from './AppointmentDetailScreen.module.css';

function getStatusStyle(status?: string) {
  switch (status) {
    case 'completed':
      return { bg: theme.colors.successBg, text: theme.colors.successText, dot: theme.colors.success };
    case 'cancelled':
      return { bg: theme.colors.errorBg, text: theme.colors.errorText, dot: theme.colors.error };
    default:
      return { bg: theme.colors.scheduledBg, text: theme.colors.scheduledText, dot: theme.colors.scheduled };
  }
}

export default function AppointmentDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { appointments, isOnline, updateAppointmentOptimistic, markCompletedOffline, markCancelledOffline } =
    useAppointmentsContext();

  const fromList = id ? appointments.find((a) => a.id === id) : undefined;
  const [loaded, setLoaded] = useState<Appointment | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    if (fromList) {
      setLoaded(fromList);
      return;
    }
    let cancelled = false;
    setLoadErr(null);
    void getDoc(doc(db, 'appointments', id))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setLoadErr('Appointment not found');
          setLoaded(null);
          return;
        }
        const data = snap.data() as Appointment;
        const uid = auth.currentUser?.uid;
        const allowed =
          (data.type === 'home' && data.homeVisitorStaffId === uid) ||
          (data.type === 'center' && data.assignedStaffId === uid);
        if (!uid || !allowed) {
          setLoadErr('Appointment not found');
          setLoaded(null);
          return;
        }
        setLoaded({ ...(data as object), id: snap.id } as Appointment);
      })
      .catch(() => {
        if (!cancelled) setLoadErr('Failed to load appointment');
      });
    return () => {
      cancelled = true;
    };
  }, [id, fromList]);

  const appointment = fromList || loaded;
  const [feedback, setFeedback] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [centerName, setCenterName] = useState<string | null>(appointment?.centerName || null);

  useEffect(() => {
    const resolved = appointment?.centerName;
    if (resolved) {
      setCenterName(resolved);
      return;
    }
    const cid = appointment?.centerId;
    if (!cid) {
      setCenterName(null);
      return;
    }
    let cancelled = false;
    void getDoc(doc(db, 'centers', cid))
      .then((snap) => {
        if (cancelled) return;
        const name = (snap.data() as { name?: string })?.name;
        setCenterName(name || null);
      })
      .catch(() => {
        if (!cancelled) setCenterName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [appointment?.centerId, appointment?.centerName]);

  if (!id) {
    navigate('/app', { replace: true });
    return null;
  }

  if (loadErr) {
    return (
      <div className={styles.container}>
        <div className={styles.topBar}>
          <button type="button" className={styles.backBtn} onClick={() => navigate(-1)}>
            <IoArrowBack size={22} />
            Back
          </button>
        </div>
        <div className={styles.scroll}>
          <p className={styles.value}>{loadErr}</p>
        </div>
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className={styles.container}>
        <div className={styles.topBar}>
          <button type="button" className={styles.backBtn} onClick={() => navigate(-1)}>
            <IoArrowBack size={22} />
            Back
          </button>
        </div>
        <div className={styles.scroll}>
          <p className={styles.value}>Loading…</p>
        </div>
      </div>
    );
  }

  const isScheduled = appointment.status === 'scheduled' || !appointment.status;
  const statusStyle = getStatusStyle(appointment.status);
  const startIso = getStartForDisplay(appointment.start);
  const showVisitServices = isEligibleForVisitServicesLogging(appointment);

  const submitCompleted = async () => {
    if (!appointment.id) return;
    const fb = feedback.trim() || '';
    setSaving(true);
    setShowModal(false);
    setFeedback('');

    updateAppointmentOptimistic(appointment.id, { status: 'completed', feedback: fb });

    if (isOnline) {
      try {
        await updateDoc(doc(db, 'appointments', appointment.id), {
          status: 'completed',
          feedback: fb,
          updatedAt: serverTimestamp(),
        });
        navigate('/app');
      } catch {
        window.alert('Failed to update. Changes saved locally and will sync when online.');
        markCompletedOffline(appointment.id, fb);
        navigate('/app');
      } finally {
        setSaving(false);
      }
    } else {
      markCompletedOffline(appointment.id, fb);
      setSaving(false);
      navigate('/app');
    }
  };

  const handleMarkCancelled = () => {
    if (!window.confirm('Are you sure you want to mark this appointment as cancelled?')) return;
    if (!appointment.id) return;
    setSaving(true);
    updateAppointmentOptimistic(appointment.id, { status: 'cancelled' });

    if (isOnline) {
      void (async () => {
        try {
          await updateDoc(doc(db, 'appointments', appointment.id), {
            status: 'cancelled',
            updatedAt: serverTimestamp(),
          });
          navigate('/app');
        } catch {
          window.alert('Failed to update. Changes saved locally and will sync when online.');
          markCancelledOffline(appointment.id);
          navigate('/app');
        } finally {
          setSaving(false);
        }
      })();
    } else {
      markCancelledOffline(appointment.id);
      setSaving(false);
      navigate('/app');
    }
  };

  const openMaps = () => {
    if (appointment.address) {
      window.open(`https://maps.google.com/?q=${encodeURIComponent(appointment.address)}`, '_blank');
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <button type="button" className={styles.backBtn} onClick={() => navigate(-1)}>
          <IoArrowBack size={22} />
          Back
        </button>
      </div>

      <div className={styles.scroll}>
        <div className={styles.hero}>
          <h1 className={styles.patientName}>{appointment.patientName || appointment.title || 'Patient'}</h1>
          <span className={styles.statusBadge} style={{ backgroundColor: statusStyle.bg, color: statusStyle.text }}>
            <span className={styles.statusDot} style={{ backgroundColor: statusStyle.dot }} />
            {appointment.status || 'scheduled'}
          </span>
        </div>

        <div className={styles.callWrap}>
          <button
            type="button"
            className={styles.callBtn}
            disabled={!appointment.patientPhone}
            onClick={() => {
              const phone = appointment.patientPhone?.replace(/\D/g, '') || '';
              if (phone) window.open(`tel:${phone}`, '_self');
              else window.alert('No phone number available');
            }}
          >
            <IoCall size={24} />
            Call Patient
          </button>
        </div>

        <div className={styles.details}>
          <div className={styles.section}>
            <p className={styles.label}>Date & Time</p>
            <div className={styles.row}>
              <div className={styles.dtRow}>
                <IoCalendarOutline size={18} color={theme.colors.textMuted} />
                <span className={styles.value}>{formatDateLong(startIso)}</span>
              </div>
              <div className={styles.dtRow}>
                <IoTimeOutline size={18} color={theme.colors.textMuted} />
                <span className={styles.value}>{formatTime(startIso)}</span>
              </div>
            </div>
          </div>

          <div className={styles.section}>
            <p className={styles.label}>Location</p>
            {appointment.address ? (
              <button type="button" className={styles.locBtn} onClick={openMaps}>
                <IoLocationOutline size={18} />
                <span style={{ flex: 1 }}>{appointment.address}</span>
                <IoOpenOutline size={16} />
              </button>
            ) : (
              <p className={`${styles.value} ${styles.muted}`}>—</p>
            )}
          </div>

          <div className={styles.section}>
            <p className={styles.label}>Reference</p>
            <p className={styles.value}>{appointment.reference || '—'}</p>
          </div>

          <div className={styles.section}>
            <p className={styles.label}>Telecaller</p>
            <p className={styles.value}>{appointment.telecaller || '—'}</p>
          </div>

          {centerName || appointment.centerId ? (
            <div className={styles.section}>
              <p className={styles.label}>Center</p>
              <p className={styles.value}>{centerName || appointment.centerId || '—'}</p>
            </div>
          ) : null}

          {appointment.notes ? (
            <div className={styles.section}>
              <p className={styles.label}>Remarks / Notes</p>
              <p className={styles.value}>{appointment.notes}</p>
            </div>
          ) : null}
        </div>

        {isScheduled ? (
          <div className={styles.actions}>
            {showVisitServices ? (
              <button
                type="button"
                className={styles.btnServices}
                disabled={saving}
                onClick={() =>
                  navigate(`/app/visit-services/${encodeURIComponent(appointment.id)}`)
                }
              >
                <IoMedkitOutline size={20} />
                Log visit services
              </button>
            ) : null}
            <button
              type="button"
              className={styles.btnComplete}
              disabled={saving}
              onClick={() => setShowModal(true)}
            >
              <IoCheckmarkCircle size={20} />
              Mark Completed
            </button>
            <button type="button" className={styles.btnCancel} disabled={saving} onClick={handleMarkCancelled}>
              <IoCloseCircleOutline size={20} />
              Mark Cancelled
            </button>
          </div>
        ) : null}

        {appointment.status === 'completed' && appointment.feedback ? (
          <div className={styles.feedbackCard}>
            <p className={styles.label}>Feedback</p>
            <p className={styles.value}>{appointment.feedback}</p>
          </div>
        ) : null}
      </div>

      {showModal ? (
        <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className={styles.modal}>
            <h2 id="modal-title" className={styles.modalTitle}>
              Mark as Completed
            </h2>
            <p className={styles.modalSub}>Add feedback (optional)</p>
            <textarea
              className={styles.textarea}
              placeholder="How did the visit go?"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              disabled={saving}
            />
            <div className={styles.modalActions}>
              <button type="button" className={styles.modalCancel} onClick={() => setShowModal(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className={styles.modalSubmit} onClick={submitCompleted} disabled={saving}>
                {saving ? '…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
