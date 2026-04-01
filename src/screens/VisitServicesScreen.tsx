import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { IoArrowBack, IoTrashOutline, IoAddCircleOutline } from 'react-icons/io5';
import { db } from '../firebase';
import type { Appointment } from '../types';
import { useAppointmentsContext } from '../context/AppointmentsContext';
import { isEligibleForVisitServicesLogging } from '../utils/appointmentPayable';
import { submitLogVisitServices, type VisitServicesPayload } from '../api/logVisitServices';
import styles from './VisitServicesScreen.module.css';

type HtEntry = { id: string; testType: string; price: string };

function newId() {
  return `ht-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function VisitServicesScreen() {
  const { appointmentId: rawId } = useParams<{ appointmentId: string }>();
  const appointmentId = rawId ? decodeURIComponent(rawId) : '';
  const navigate = useNavigate();
  const { appointments, isOnline } = useAppointmentsContext();

  const [resolved, setResolved] = useState<Appointment | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const [hearingTest, setHearingTest] = useState(false);
  const [htEntries, setHtEntries] = useState<HtEntry[]>([{ id: newId(), testType: '', price: '' }]);
  const [testDoneBy, setTestDoneBy] = useState('');
  const [testResults, setTestResults] = useState('');
  const [recommendations, setRecommendations] = useState('');

  const [accessory, setAccessory] = useState(false);
  const [accessoryName, setAccessoryName] = useState('');
  const [accessoryDetails, setAccessoryDetails] = useState('');
  const [accessoryFOC, setAccessoryFOC] = useState(false);
  const [accessoryAmount, setAccessoryAmount] = useState('');
  const [accessoryQuantity, setAccessoryQuantity] = useState('1');

  const [programming, setProgramming] = useState(false);
  const [programmingReason, setProgrammingReason] = useState('');
  const [programmingAmount, setProgrammingAmount] = useState('');
  const [programmingDoneBy, setProgrammingDoneBy] = useState('');
  const [hearingAidPurchaseDate, setHearingAidPurchaseDate] = useState('');
  const [hearingAidName, setHearingAidName] = useState('');
  const [underWarranty, setUnderWarranty] = useState(false);
  const [warranty, setWarranty] = useState('');

  const [counselling, setCounselling] = useState(false);
  const [counsellingNotes, setCounsellingNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!appointmentId) {
      setResolved(null);
      setLoading(false);
      return;
    }
    const fromList = appointments.find((a) => a.id === appointmentId);
    if (fromList) {
      setResolved(fromList);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void getDoc(doc(db, 'appointments', appointmentId))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setResolved(null);
          return;
        }
        setResolved({ ...(snap.data() as object), id: snap.id } as Appointment);
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appointmentId, appointments]);

  const eligible = useMemo(() => (resolved ? isEligibleForVisitServicesLogging(resolved) : false), [resolved]);

  const buildPayload = (): { ok: true; services: VisitServicesPayload } | { ok: false; message: string } => {
    const services: VisitServicesPayload = {};
    if (hearingTest) {
      const entries = htEntries
        .map((e) => ({
          id: e.id,
          testType: e.testType.trim(),
          price: Math.max(0, parseFloat(e.price) || 0),
        }))
        .filter((e) => e.testType);
      if (entries.length === 0) {
        return { ok: false, message: 'Add at least one hearing test with a test type.' };
      }
      services.hearingTest = {
        hearingTestEntries: entries,
        testDoneBy: testDoneBy.trim() || undefined,
        testResults: testResults.trim() || undefined,
        recommendations: recommendations.trim() || undefined,
      };
    }
    if (accessory) {
      const name = accessoryName.trim();
      if (!name) {
        return { ok: false, message: 'Accessory name is required.' };
      }
      services.accessory = {
        accessoryName: name,
        accessoryDetails: accessoryDetails.trim() || undefined,
        accessoryFOC,
        accessoryAmount:
          accessoryAmount.trim() !== '' ? Math.max(0, parseFloat(accessoryAmount) || 0) : undefined,
        accessoryQuantity:
          accessoryQuantity.trim() !== '' ? Math.max(1, Math.floor(parseFloat(accessoryQuantity) || 1)) : undefined,
      };
    }
    if (programming) {
      services.programming = {
        programmingReason: programmingReason.trim() || undefined,
        programmingAmount:
          programmingAmount.trim() !== '' ? Math.max(0, parseFloat(programmingAmount) || 0) : undefined,
        programmingDoneBy: programmingDoneBy.trim() || undefined,
        hearingAidPurchaseDate: hearingAidPurchaseDate.trim() || undefined,
        hearingAidName: hearingAidName.trim() || undefined,
        underWarranty,
        warranty: warranty.trim() || undefined,
      };
    }
    if (counselling) {
      services.counselling = { notes: counsellingNotes.trim() || undefined };
    }

    if (!services.hearingTest && !services.accessory && !services.programming && !services.counselling) {
      return { ok: false, message: 'Turn on at least one service.' };
    }

    return { ok: true, services };
  };

  const handleSubmit = async () => {
    if (!resolved?.id) return;
    if (!isOnline) {
      window.alert('Visit logging requires an internet connection.');
      return;
    }
    const built = buildPayload();
    if (!built.ok) {
      window.alert(built.message);
      return;
    }
    setSubmitting(true);
    try {
      const r = await submitLogVisitServices({
        appointmentId: resolved.id,
        services: built.services,
      });
      if (!r.ok) {
        window.alert(r.error || 'Failed to save');
        return;
      }
      window.alert('Visit services were logged to the enquiry.');
      navigate(-1);
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  if (!appointmentId) {
    navigate('/app', { replace: true });
    return null;
  }

  if (loading || resolved === undefined) {
    return (
      <div className={styles.container}>
        <div className={styles.centered}>Loading…</div>
      </div>
    );
  }

  if (!resolved) {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
          <button type="button" className={styles.backBtn} onClick={() => navigate(-1)}>
            <IoArrowBack size={22} />
            Back
          </button>
        </header>
        <p className={styles.scroll}>Appointment not found.</p>
      </div>
    );
  }

  if (!eligible) {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
          <button type="button" className={styles.backBtn} onClick={() => navigate(-1)}>
            <IoArrowBack size={22} />
            Back
          </button>
        </header>
        <div className={styles.scroll}>
          <p className={styles.warnTitle}>Cannot log visit services</p>
          <p className={styles.muted}>
            The appointment must be scheduled for today, linked to an enquiry, and not completed or cancelled.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={() => navigate(-1)} disabled={submitting}>
          <IoArrowBack size={22} />
          Back
        </button>
      </header>

      <div className={styles.scroll}>
        <h1 className={styles.pageTitle}>Log visit services</h1>
        <p className={styles.subtitle}>
          {resolved.patientName || resolved.title || 'Patient'} · Enquiry {resolved.enquiryId || '—'}
        </p>
        <p className={styles.hint}>Requires internet. Same rules as CRM enquiry visits (non-payment).</p>

        <section className={styles.card}>
          <div className={styles.rowBetween}>
            <span className={styles.sectionTitle}>Hearing test</span>
            <input
              type="checkbox"
              checked={hearingTest}
              onChange={(e) => setHearingTest(e.target.checked)}
              aria-label="Hearing test"
            />
          </div>
          {hearingTest ? (
            <>
              {htEntries.map((row, idx) => (
                <div key={row.id} className={styles.htRow}>
                  <input
                    className={styles.input}
                    placeholder="Test type"
                    value={row.testType}
                    onChange={(e) => {
                      const next = [...htEntries];
                      next[idx] = { ...row, testType: e.target.value };
                      setHtEntries(next);
                    }}
                  />
                  <input
                    className={`${styles.input} ${styles.priceInput}`}
                    placeholder="₹"
                    inputMode="decimal"
                    value={row.price}
                    onChange={(e) => {
                      const next = [...htEntries];
                      next[idx] = { ...row, price: e.target.value };
                      setHtEntries(next);
                    }}
                  />
                  <button
                    type="button"
                    className={styles.trashBtn}
                    disabled={htEntries.length <= 1}
                    onClick={() => setHtEntries((prev) => prev.filter((r) => r.id !== row.id))}
                    aria-label="Remove row"
                  >
                    <IoTrashOutline size={22} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.addRow}
                onClick={() => setHtEntries((prev) => [...prev, { id: newId(), testType: '', price: '' }])}
              >
                <IoAddCircleOutline size={18} />
                Add test line
              </button>
              <Field label="Test done by" value={testDoneBy} onChange={setTestDoneBy} />
              <Field label="Test results" value={testResults} onChange={setTestResults} multiline />
              <Field label="Recommendations" value={recommendations} onChange={setRecommendations} multiline />
            </>
          ) : null}
        </section>

        <section className={styles.card}>
          <div className={styles.rowBetween}>
            <span className={styles.sectionTitle}>Accessory</span>
            <input
              type="checkbox"
              checked={accessory}
              onChange={(e) => setAccessory(e.target.checked)}
              aria-label="Accessory"
            />
          </div>
          {accessory ? (
            <>
              <Field label="Accessory name *" value={accessoryName} onChange={setAccessoryName} />
              <Field label="Details" value={accessoryDetails} onChange={setAccessoryDetails} multiline />
              <div className={styles.rowBetween}>
                <span className={styles.sectionTitle} style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                  Free of charge
                </span>
                <input
                  type="checkbox"
                  checked={accessoryFOC}
                  onChange={(e) => setAccessoryFOC(e.target.checked)}
                />
              </div>
              <Field label="Amount (₹)" value={accessoryAmount} onChange={setAccessoryAmount} inputMode="decimal" />
              <Field label="Quantity" value={accessoryQuantity} onChange={setAccessoryQuantity} inputMode="numeric" />
            </>
          ) : null}
        </section>

        <section className={styles.card}>
          <div className={styles.rowBetween}>
            <span className={styles.sectionTitle}>Programming</span>
            <input
              type="checkbox"
              checked={programming}
              onChange={(e) => setProgramming(e.target.checked)}
              aria-label="Programming"
            />
          </div>
          {programming ? (
            <>
              <Field label="Reason" value={programmingReason} onChange={setProgrammingReason} multiline />
              <Field label="Amount (₹)" value={programmingAmount} onChange={setProgrammingAmount} inputMode="decimal" />
              <Field label="Done by" value={programmingDoneBy} onChange={setProgrammingDoneBy} />
              <Field label="HA purchase date" value={hearingAidPurchaseDate} onChange={setHearingAidPurchaseDate} />
              <Field label="Hearing aid name" value={hearingAidName} onChange={setHearingAidName} />
              <div className={styles.rowBetween}>
                <span className={styles.sectionTitle} style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                  Under warranty
                </span>
                <input
                  type="checkbox"
                  checked={underWarranty}
                  onChange={(e) => setUnderWarranty(e.target.checked)}
                />
              </div>
              <Field label="Warranty" value={warranty} onChange={setWarranty} />
            </>
          ) : null}
        </section>

        <section className={styles.card}>
          <div className={styles.rowBetween}>
            <span className={styles.sectionTitle}>Counselling</span>
            <input
              type="checkbox"
              checked={counselling}
              onChange={(e) => setCounselling(e.target.checked)}
              aria-label="Counselling"
            />
          </div>
          {counselling ? (
            <Field label="Notes" value={counsellingNotes} onChange={setCounsellingNotes} multiline />
          ) : null}
        </section>

        <button
          type="button"
          className={styles.submitBtn}
          onClick={() => void handleSubmit()}
          disabled={!isOnline || submitting}
        >
          {submitting ? 'Saving…' : 'Save to CRM'}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <div className={styles.field}>
      <label className={styles.sectionTitle} style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
        {label}
      </label>
      {multiline ? (
        <textarea
          className={`${styles.input} ${styles.inputMultiline}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={styles.input}
          style={{ width: '100%' }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={inputMode}
        />
      )}
    </div>
  );
}
