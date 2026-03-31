import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { IoArrowBack } from 'react-icons/io5';
import { auth, db } from '../firebase';
import type { Appointment } from '../types';
import { useAppointmentsContext } from '../context/AppointmentsContext';
import { isPayableAppointmentForPayment } from '../utils/appointmentPayable';
import { getStartForDisplay, formatTime } from '../dateUtils';
import { submitCollectPayment, type PaymentMode, type ReceiptType } from '../api/collectPayment';
import styles from './ReceiptActionScreen.module.css';

export default function ReceiptActionScreen() {
  const { appointmentId: appointmentIdParam } = useParams<{ appointmentId: string }>();
  const appointmentId = appointmentIdParam ? decodeURIComponent(appointmentIdParam) : '';
  const navigate = useNavigate();
  const { appointments } = useAppointmentsContext();
  const uid = auth.currentUser?.uid;

  const [resolved, setResolved] = useState<Appointment | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [receiptType, setReceiptType] = useState<ReceiptType>('booking');
  const [submitting, setSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const fromCache = useMemo(
    () => appointments.find((a) => a.id === appointmentId) || null,
    [appointments, appointmentId]
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!appointmentId || !uid) {
        setResolved(null);
        setLoading(false);
        return;
      }

      if (fromCache && isPayableAppointmentForPayment(fromCache)) {
        const mine =
          (fromCache.type === 'home' && fromCache.homeVisitorStaffId === uid) ||
          (fromCache.type === 'center' && fromCache.assignedStaffId === uid);
        if (mine) {
          setResolved(fromCache);
          setLoading(false);
          return;
        }
      }

      try {
        const snap = await getDoc(doc(db, 'appointments', appointmentId));
        if (cancelled) return;
        if (!snap.exists()) {
          setResolved(null);
          return;
        }
        const apt = { id: snap.id, ...snap.data() } as Appointment;
        const mine =
          (apt.type === 'home' && apt.homeVisitorStaffId === uid) ||
          (apt.type === 'center' && apt.assignedStaffId === uid);
        if (!mine || !isPayableAppointmentForPayment(apt)) {
          setResolved(null);
          return;
        }
        setResolved(apt);
      } catch {
        if (!cancelled) setResolved(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    void load();
    return () => {
      cancelled = true;
    };
  }, [appointmentId, uid, fromCache]);

  useEffect(() => {
    if (resolved === null && !loading) {
      setErrorBanner('This appointment cannot be used for payment logging.');
    }
  }, [resolved, loading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount.replace(/,/g, '').trim());
    if (!Number.isFinite(n) || n <= 0) {
      setErrorBanner('Enter a positive amount.');
      return;
    }
    if (!resolved?.id) return;
    setSubmitting(true);
    setErrorBanner(null);
    try {
      const result = await submitCollectPayment({
        appointmentId: resolved.id,
        amount: n,
        paymentMode,
        receiptType,
      });
      if (!result.ok) {
        setErrorBanner(result.error || 'Could not send request');
        return;
      }
      alert('Receipt request sent to admin. An administrator will verify and send the official document to the patient.');
      navigate(-1);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || resolved === undefined) {
    return (
      <div className={styles.container}>
        <div className={styles.centered}>
          <div className={styles.spinner} />
        </div>
      </div>
    );
  }

  if (!resolved) {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
          <button type="button" className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
            <IoArrowBack size={22} />
          </button>
          <h1 className={styles.title}>Log payment</h1>
        </header>
        {errorBanner ? <p className={styles.errorText}>{errorBanner}</p> : null}
      </div>
    );
  }

  const typeLabel = resolved.type === 'home' ? 'Home visit' : 'Center';
  const startIso = getStartForDisplay(resolved.start);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <IoArrowBack size={22} />
        </button>
        <h1 className={styles.title}>Log payment</h1>
      </header>

      <form className={styles.form} onSubmit={handleSubmit}>
        {errorBanner ? <p className={styles.errorText}>{errorBanner}</p> : null}

        <div className={styles.card}>
          <p className={styles.sectionLabel}>Appointment</p>
          <p className={styles.patientName}>{resolved.patientName || resolved.title || 'Patient'}</p>
          <p className={styles.meta}>Enquiry ID: {resolved.enquiryId || '—'}</p>
          <p className={styles.meta}>Type: {typeLabel}</p>
          <p className={styles.meta}>Time: {formatTime(startIso)}</p>
        </div>

        <label className={styles.label} htmlFor="amount">
          Amount (₹)
        </label>
        <input
          id="amount"
          className={styles.input}
          inputMode="decimal"
          placeholder="0"
          value={amount}
          onChange={(ev) => setAmount(ev.target.value)}
          disabled={submitting}
        />

        <p className={styles.label}>Payment mode</p>
        <div className={styles.chips}>
          {(['cash', 'upi', 'card'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`${styles.chip} ${paymentMode === m ? styles.chipActive : ''}`}
              onClick={() => setPaymentMode(m)}
              disabled={submitting}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>

        <p className={styles.label}>Receipt type</p>
        <div className={styles.chips}>
          {(['trial', 'booking', 'invoice'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.chip} ${receiptType === t ? styles.chipActive : ''}`}
              onClick={() => setReceiptType(t)}
              disabled={submitting}
            >
              {t}
            </button>
          ))}
        </div>

        <button type="submit" className={styles.submit} disabled={submitting}>
          {submitting ? 'Sending…' : 'Send to admin'}
        </button>
      </form>
    </div>
  );
}
