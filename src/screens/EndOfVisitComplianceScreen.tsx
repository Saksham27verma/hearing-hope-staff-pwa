import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  IoArrowBack,
  IoCartOutline,
  IoCheckmarkCircle,
  IoLocateOutline,
  IoMedkitOutline,
  IoShieldCheckmarkOutline,
  IoTimeOutline,
} from 'react-icons/io5';
import { auth, db } from '../firebase';
import type { Appointment, ComplianceFormData, GpsLocation } from '../types';
import { useAppointmentsContext } from '../context/AppointmentsContext';
import { isAppointmentToday } from '../dateUtils';
import {
  isEligibleForCheckoutCommerceStaging,
  isEligibleForVisitServicesLogging,
} from '../utils/appointmentPayable';
import {
  completeVisitCompliance,
  saveCheckoutDraft,
  verifyCompliancePin,
} from '../api/visitCompliance';
import { submitCollectPayment } from '../api/collectPayment';
import styles from './EndOfVisitComplianceScreen.module.css';

type WizardStep = 'services' | 'commerce' | 'wrapUp' | 'pin';
type YesNo = 'yes' | 'no' | '';

function ynToBool(v: YesNo): boolean | null {
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return null;
}

function formToYesNo(v: boolean | undefined | null): YesNo {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  return '';
}

/**
 * Resume step from server. PIN is last — only jump there when staff already requested it.
 */
function resolveServerStep(a: Appointment): WizardStep | null {
  const cs = String(a.complianceStatus || '').toLowerCase();
  if (
    cs === 'pending_verification' ||
    cs === 'awaiting_telecaller_pin' ||
    (a.telecaller_pin && String(a.telecaller_pin).trim())
  ) {
    return 'pin';
  }
  if (a.telecaller_verified || cs === 'incomplete_compliance') {
    // PIN done but complete not finished — rare; send to wrapUp to re-submit
    return 'wrapUp';
  }
  const draft = a.checkoutDraft;
  if (draft?.gps_location && draft?.compliance_form_data) return 'wrapUp';
  if (draft?.commerce || draft?.commerceSkipped) return 'wrapUp';
  if (draft?.services || draft?.servicesSkipped) return 'commerce';
  return null;
}

const STEP_ORDER: WizardStep[] = ['services', 'commerce', 'wrapUp', 'pin'];

const STEP_LABELS: Record<WizardStep, string> = {
  services: 'Services',
  commerce: 'Sale',
  wrapUp: 'Form',
  pin: 'PIN',
};

export default function EndOfVisitComplianceScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isOnline, updateAppointmentOptimistic } = useAppointmentsContext();

  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStep>('services');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [pin, setPin] = useState('');
  const [gps, setGps] = useState<GpsLocation | null>(null);
  const [feedback, setFeedback] = useState('');

  const [wearingIdUniformBag, setWearingIdUniformBag] = useState<YesNo>('');
  const [sharedPersonalContact, setSharedPersonalContact] = useState<YesNo>('');
  const [focHomeVisitsCommitted, setFocHomeVisitsCommitted] = useState('');
  const [freeBatteryBoxesCommitted, setFreeBatteryBoxesCommitted] = useState<YesNo>('');
  const [freeBatteryBoxesQty, setFreeBatteryBoxesQty] = useState('');
  const [explainedAccessoriesCharges, setExplainedAccessoriesCharges] = useState<YesNo>('');
  const [explainedWarranty, setExplainedWarranty] = useState<YesNo>('');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const unsub = onSnapshot(
      doc(db, 'appointments', id),
      (snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setLoadErr('Appointment not found');
          return;
        }
        const data = { id: snap.id, ...(snap.data() as object) } as Appointment;
        const uid = auth.currentUser?.uid;
        const allowed =
          (data.type === 'home' && data.homeVisitorStaffId === uid) ||
          (data.type === 'center' && data.assignedStaffId === uid);
        if (!uid || !allowed || data.type !== 'home') {
          setLoadErr('Home visit checkout is only for your assigned home visits.');
          return;
        }
        if (!isAppointmentToday(data.start)) {
          setLoadErr('Home visit checkout is only available for today’s appointments.');
          return;
        }
        if (data.status === 'cancelled') {
          setLoadErr('This appointment is cancelled.');
          return;
        }
        if (data.status === 'completed' && data.complianceStatus === 'completed') {
          navigate(`/app/visit/${encodeURIComponent(data.id)}`, { replace: true });
          return;
        }
        setAppointment(data);

        if (!hydrated && data.checkoutDraft) {
          const d = data.checkoutDraft;
          if (d.gps_location) setGps(d.gps_location);
          if (d.feedback) setFeedback(d.feedback);
          if (d.compliance_form_data) {
            const f = d.compliance_form_data;
            setWearingIdUniformBag(formToYesNo(f.wearingIdUniformBag));
            setSharedPersonalContact(formToYesNo(f.sharedPersonalContact));
            setFocHomeVisitsCommitted(String(f.focHomeVisitsCommitted ?? ''));
            setFreeBatteryBoxesCommitted(formToYesNo(f.freeBatteryBoxesCommitted));
            setFreeBatteryBoxesQty(
              f.freeBatteryBoxesQty != null ? String(f.freeBatteryBoxesQty) : ''
            );
            setExplainedAccessoriesCharges(formToYesNo(f.explainedAccessoriesCharges));
            setExplainedWarranty(formToYesNo(f.explainedWarranty));
          }
          setHydrated(true);
        }

        const serverStep = resolveServerStep(data);
        setStep((prev) => {
          if (serverStep === 'pin') return 'pin';
          // Don't yank staff backwards while editing earlier steps
          if (prev === 'pin') return prev;
          // After form is filled (wrapUp), stay there until staff requests PIN
          if (prev === 'wrapUp') return prev;
          if (serverStep && STEP_ORDER.indexOf(serverStep) > STEP_ORDER.indexOf(prev)) {
            return serverStep;
          }
          return prev;
        });
      },
      () => {
        if (!cancelled) setLoadErr('Failed to load appointment');
      }
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [id, navigate, hydrated]);

  const stepIndex = STEP_ORDER.indexOf(step);
  const progressPct = useMemo(
    () => Math.round(((stepIndex + 1) / STEP_ORDER.length) * 100),
    [stepIndex]
  );

  const canLogServices = appointment ? isEligibleForVisitServicesLogging(appointment) : false;
  const canStageCommerce = appointment ? isEligibleForCheckoutCommerceStaging(appointment) : false;

  const draft = appointment?.checkoutDraft;
  const servicesDone = Boolean(draft?.services || draft?.servicesSkipped);
  const commerceDone = Boolean(draft?.commerce || draft?.commerceSkipped);

  const pinReady =
    Boolean(appointment?.telecaller_pin && String(appointment.telecaller_pin).trim()) ||
    String(appointment?.complianceStatus || '').toLowerCase() === 'pending_verification';

  const buildForm = (): ComplianceFormData | null => {
    const wearing = ynToBool(wearingIdUniformBag);
    const shared = ynToBool(sharedPersonalContact);
    const batteries = ynToBool(freeBatteryBoxesCommitted);
    const accessories = ynToBool(explainedAccessoriesCharges);
    const warranty = ynToBool(explainedWarranty);
    const foc = Number(focHomeVisitsCommitted);
    if (
      wearing == null ||
      shared == null ||
      batteries == null ||
      accessories == null ||
      warranty == null ||
      !Number.isFinite(foc) ||
      foc < 0
    ) {
      return null;
    }
    if (batteries && (!Number.isFinite(Number(freeBatteryBoxesQty)) || Number(freeBatteryBoxesQty) < 1)) {
      return null;
    }
    return {
      wearingIdUniformBag: wearing,
      sharedPersonalContact: shared,
      focHomeVisitsCommitted: foc,
      freeBatteryBoxesCommitted: batteries,
      freeBatteryBoxesQty: batteries ? Number(freeBatteryBoxesQty) : null,
      explainedAccessoriesCharges: accessories,
      explainedWarranty: warranty,
      connectedWithTelecaller: true,
    };
  };

  const checklistReady = Boolean(buildForm());

  const captureGps = () => {
    setError(null);
    if (!isOnline) {
      setError('You must be online to capture GPS.');
      return;
    }
    if (!navigator.geolocation) {
      setError('Geolocation is not supported on this device.');
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
          capturedAt: new Date().toISOString(),
        });
      },
      (err) => {
        setBusy(false);
        setError(err.message || 'Could not get GPS location');
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  const skipServices = async () => {
    if (!appointment) return;
    setBusy(true);
    setError(null);
    const result = await saveCheckoutDraft({
      appointmentId: appointment.id,
      patch: { servicesSkipped: true },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error || 'Could not save');
      return;
    }
    updateAppointmentOptimistic(appointment.id, {
      checkoutDraft: { ...(appointment.checkoutDraft || {}), servicesSkipped: true },
    });
    setStep('commerce');
  };

  const skipCommerce = async () => {
    if (!appointment) return;
    setBusy(true);
    setError(null);
    const result = await saveCheckoutDraft({
      appointmentId: appointment.id,
      patch: { commerceSkipped: true },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error || 'Could not save');
      return;
    }
    updateAppointmentOptimistic(appointment.id, {
      checkoutDraft: { ...(appointment.checkoutDraft || {}), commerceSkipped: true },
    });
    setStep('wrapUp');
  };

  const requestTelecallerPin = async () => {
    if (!appointment) return;
    setError(null);
    if (!gps) {
      setError('Capture GPS before requesting the telecaller PIN.');
      return;
    }
    const form = buildForm();
    if (!form) {
      setError('Answer every checklist question before requesting the PIN.');
      return;
    }
    if (!servicesDone) {
      setError('Complete or skip visit services first.');
      return;
    }
    if (!commerceDone) {
      setError('Add booking/trial/sale or mark as not needed first.');
      return;
    }
    setBusy(true);
    const result = await saveCheckoutDraft({
      appointmentId: appointment.id,
      patch: {
        gps_location: gps,
        compliance_form_data: form,
        feedback: feedback.trim() || undefined,
      },
      readyForPin: true,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error || 'Could not notify telecaller');
      return;
    }
    updateAppointmentOptimistic(appointment.id, {
      complianceStatus: 'awaiting_telecaller_pin',
      checkoutReadyForPin: true,
      checkoutDraft: {
        ...(appointment.checkoutDraft || {}),
        gps_location: gps,
        compliance_form_data: form,
        feedback: feedback.trim() || undefined,
      },
    });
    setStep('pin');
  };

  const submitPinAndFinish = async () => {
    if (!appointment) return;
    setError(null);
    if (pin.length !== 4) {
      setError('Enter the 4-digit PIN from the telecaller.');
      return;
    }
    const form =
      buildForm() ||
      appointment.checkoutDraft?.compliance_form_data ||
      null;
    const loc = gps || appointment.checkoutDraft?.gps_location || null;
    if (!form || !loc) {
      setError('Checkout form / GPS missing. Go back and complete the form step.');
      return;
    }

    setBusy(true);
    const verified = await verifyCompliancePin({ appointmentId: appointment.id, pin });
    if (!verified.ok) {
      setBusy(false);
      setError(verified.error || 'PIN verification failed');
      return;
    }

    const completed = await completeVisitCompliance({
      appointmentId: appointment.id,
      feedback: (feedback || appointment.checkoutDraft?.feedback || '').trim() || undefined,
      gps_location: loc,
      compliance_form_data: form,
    });
    if (!completed.ok) {
      setBusy(false);
      setError(completed.error || 'Failed to complete visit after PIN');
      return;
    }

    // Submit staged commerce to admin (if any)
    const commerce = appointment.checkoutDraft?.commerce;
    if (commerce && commerce.receiptType && commerce.amount > 0) {
      const pay = await submitCollectPayment({
        appointmentId: appointment.id,
        amount: Number(commerce.amount),
        paymentMode: commerce.paymentMode,
        receiptType: commerce.receiptType,
        details: commerce.details as Parameters<typeof submitCollectPayment>[0]['details'],
      });
      if (!pay.ok) {
        setBusy(false);
        setError(
          pay.error ||
            'Visit completed, but booking/sale could not be sent to admin. Open Booking / sale from the visit.'
        );
        updateAppointmentOptimistic(appointment.id, {
          status: 'completed',
          telecaller_verified: true,
          complianceStatus: 'completed',
          gps_location: loc,
          compliance_form_data: form,
        });
        navigate(`/app/receipt/${encodeURIComponent(appointment.id)}?mode=payment`, { replace: true });
        return;
      }
    }

    setBusy(false);
    updateAppointmentOptimistic(appointment.id, {
      status: 'completed',
      telecaller_verified: true,
      complianceStatus: 'completed',
      gps_location: loc,
      compliance_form_data: form,
    });
    navigate(`/app/visit/${encodeURIComponent(appointment.id)}`, { replace: true });
  };

  const handleBack = () => {
    setError(null);
    if (step === 'commerce') {
      setStep('services');
      return;
    }
    if (step === 'wrapUp') {
      setStep('commerce');
      return;
    }
    if (step === 'pin') {
      // Don't go back to editing once PIN requested — stay or exit
      navigate(id ? `/app/visit/${id}` : '/app');
      return;
    }
    navigate(id ? `/app/visit/${id}` : '/app');
  };

  const radioRow = (
    fieldId: string,
    label: string,
    value: YesNo,
    onChange: (v: YesNo) => void
  ) => (
    <fieldset className={styles.field}>
      <legend className={styles.label}>{label}</legend>
      <div className={styles.radioRow}>
        <label className={`${styles.choice} ${value === 'yes' ? styles.choiceOn : ''}`}>
          <input
            type="radio"
            name={fieldId}
            checked={value === 'yes'}
            onChange={() => onChange('yes')}
            disabled={busy}
          />
          Yes
        </label>
        <label className={`${styles.choice} ${value === 'no' ? styles.choiceOn : ''}`}>
          <input
            type="radio"
            name={fieldId}
            checked={value === 'no'}
            onChange={() => onChange('no')}
            disabled={busy}
          />
          No
        </label>
      </div>
    </fieldset>
  );

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
          <p className={styles.error}>{loadErr}</p>
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
          <p className={styles.muted}>Loading checkout…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <button type="button" className={styles.backBtn} onClick={handleBack}>
          <IoArrowBack size={22} />
          Back
        </button>
        <span className={styles.topTitle}>Home visit checkout</span>
      </div>

      <div className={styles.progressTrack} aria-hidden>
        <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
      </div>

      <div className={styles.scroll}>
        <div className={styles.hero}>
          <div className={styles.heroIcon}>
            <IoShieldCheckmarkOutline size={26} />
          </div>
          <h1 className={styles.title}>{appointment.patientName || appointment.title || 'Patient'}</h1>
          <p className={styles.sub}>
            Fill everything first · Telecaller PIN is last · Step {stepIndex + 1} of {STEP_ORDER.length}
          </p>
          <div className={styles.steps}>
            {STEP_ORDER.map((s, i) => (
              <span
                key={s}
                className={
                  i < stepIndex ? styles.stepDone : i === stepIndex ? styles.stepActive : styles.stepIdle
                }
              >
                {i + 1}. {STEP_LABELS[s]}
              </span>
            ))}
          </div>
        </div>

        {!isOnline ? (
          <p className={styles.error}>Online connection is required for home visit checkout.</p>
        ) : null}
        {error ? <p className={styles.error}>{error}</p> : null}

        {step === 'services' ? (
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>1. Visit services</h2>
            <p className={styles.muted}>
              Log hearing test, accessory, programming, or counselling. Telecaller will review this before
              confirming with the patient.
            </p>
            {canLogServices ? (
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() =>
                  navigate(
                    `/app/receipt/${encodeURIComponent(appointment.id)}?mode=services&from=checkout`
                  )
                }
              >
                <IoMedkitOutline size={20} />
                Open visit services
              </button>
            ) : (
              <p className={styles.infoBanner}>No linked enquiry — mark services as not needed.</p>
            )}
            {servicesDone ? (
              <p className={styles.infoBanner}>
                <IoCheckmarkCircle className={styles.okIcon} /> Services saved
                {draft?.servicesSkipped ? ' (not needed)' : ''}
              </p>
            ) : null}
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={!isOnline || busy}
              onClick={() => {
                if (servicesDone) setStep('commerce');
                else void skipServices();
              }}
            >
              {servicesDone ? 'Continue to booking / sale' : 'Skip — no services needed'}
            </button>
            {canLogServices && !servicesDone ? (
              <p className={styles.muted}>Open visit services above, save them, then continue — or skip if none.</p>
            ) : null}
          </div>
        ) : null}

        {step === 'commerce' ? (
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>2. Booking / trial / sale</h2>
            <p className={styles.muted}>
              Enter booking, trial, or sale details now. They are held for the telecaller to confirm, then
              sent to admin after the PIN.
            </p>
            {canStageCommerce || commerceDone ? (
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() =>
                  navigate(
                    `/app/receipt/${encodeURIComponent(appointment.id)}?mode=payment&from=checkout&draft=1`
                  )
                }
              >
                <IoCartOutline size={20} />
                {commerceDone && draft?.commerce ? 'Edit booking / trial / sale' : 'Add booking / trial / sale'}
              </button>
            ) : null}
            {commerceDone ? (
              <p className={styles.infoBanner}>
                <IoCheckmarkCircle className={styles.okIcon} />{' '}
                {draft?.commerceSkipped
                  ? 'Marked as not needed'
                  : `${String(draft?.commerce?.receiptType || 'Commerce').toUpperCase()} staged · ₹${draft?.commerce?.amount ?? 0}`}
              </p>
            ) : null}
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={!isOnline || busy}
              onClick={() => {
                if (commerceDone) setStep('wrapUp');
                else void skipCommerce();
              }}
            >
              {commerceDone ? 'Continue to checkout form' : 'Skip — no booking / sale needed'}
            </button>
            {canStageCommerce && !commerceDone ? (
              <p className={styles.muted}>Add booking/trial/sale above, or skip if not needed for this visit.</p>
            ) : null}
          </div>
        ) : null}

        {step === 'wrapUp' ? (
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>3. Checkout form</h2>
            <p className={styles.muted}>
              Capture GPS and complete the checklist. When ready, request the telecaller PIN — they will
              confirm all details with the patient.
            </p>

            <h3 className={styles.label}>GPS location</h3>
            {gps ? (
              <div className={styles.gpsBox}>
                <p className={styles.mono}>
                  {gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}
                </p>
                {gps.accuracy != null ? (
                  <p className={styles.muted}>Accuracy ±{Math.round(gps.accuracy)} m</p>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={busy || !isOnline}
              onClick={captureGps}
            >
              <IoLocateOutline size={20} />
              {busy ? 'Getting location…' : gps ? 'Recapture GPS' : 'Capture GPS'}
            </button>

            <h3 className={styles.label} style={{ marginTop: '1.25rem' }}>
              Compliance checklist
            </h3>
            {radioRow(
              'wearing',
              'Wearing company ID, uniform, and carrying the bag?',
              wearingIdUniformBag,
              setWearingIdUniformBag
            )}
            {radioRow(
              'sharedContact',
              'Shared your personal contact number with the patient?',
              sharedPersonalContact,
              setSharedPersonalContact
            )}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="foc-visits">
                FOC home visits committed
              </label>
              <input
                id="foc-visits"
                className={styles.textInput}
                type="number"
                min={0}
                step={1}
                value={focHomeVisitsCommitted}
                onChange={(e) => setFocHomeVisitsCommitted(e.target.value)}
                disabled={busy}
              />
            </div>
            {radioRow(
              'batteryBoxes',
              'Free battery boxes committed?',
              freeBatteryBoxesCommitted,
              setFreeBatteryBoxesCommitted
            )}
            {freeBatteryBoxesCommitted === 'yes' ? (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="battery-qty">
                  Battery boxes quantity
                </label>
                <input
                  id="battery-qty"
                  className={styles.textInput}
                  type="number"
                  min={1}
                  step={1}
                  value={freeBatteryBoxesQty}
                  onChange={(e) => setFreeBatteryBoxesQty(e.target.value)}
                  disabled={busy}
                />
              </div>
            ) : null}
            {radioRow(
              'accessories',
              'Explained accessories and charges?',
              explainedAccessoriesCharges,
              setExplainedAccessoriesCharges
            )}
            {radioRow(
              'warranty',
              'Explained warranty details?',
              explainedWarranty,
              setExplainedWarranty
            )}

            <div className={styles.field}>
              <label className={styles.label} htmlFor="feedback">
                Visit feedback (optional)
              </label>
              <textarea
                id="feedback"
                className={styles.textarea}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                disabled={busy}
                placeholder="How did the visit go?"
              />
            </div>

            <ul className={styles.reviewList}>
              <li>
                <IoCheckmarkCircle className={styles.okIcon} />{' '}
                {servicesDone ? 'Services ready' : 'Services still needed'}
              </li>
              <li>
                <IoCheckmarkCircle className={styles.okIcon} />{' '}
                {commerceDone ? 'Booking/sale ready' : 'Booking/sale still needed'}
              </li>
              <li>
                <IoCheckmarkCircle className={styles.okIcon} /> {gps ? 'GPS captured' : 'GPS still needed'}
              </li>
            </ul>

            <button
              type="button"
              className={styles.primaryBtn}
              disabled={busy || !isOnline || !gps || !checklistReady || !servicesDone || !commerceDone}
              onClick={() => void requestTelecallerPin()}
            >
              {busy ? 'Notifying…' : 'Request telecaller PIN (last step)'}
            </button>
          </div>
        ) : null}

        {step === 'pin' ? (
          <div className={styles.card}>
            {!pinReady ? (
              <>
                <div className={styles.waitPulse} aria-hidden>
                  <IoTimeOutline size={28} />
                </div>
                <h2 className={styles.cardTitle}>4. Wait for telecaller</h2>
                <p className={styles.muted}>
                  The telecaller will review your services, booking/sale, and checklist with the patient,
                  then generate a 4-digit PIN.
                </p>
                {appointment.telecaller ? (
                  <p className={styles.infoBanner}>Assigned telecaller: {appointment.telecaller}</p>
                ) : null}
                <p className={styles.muted}>This screen updates automatically when the PIN is ready.</p>
              </>
            ) : (
              <>
                <h2 className={styles.cardTitle}>4. Enter verification PIN</h2>
                <p className={styles.muted}>
                  After the telecaller confirms details with the patient, enter the PIN to finish the visit.
                </p>
                <input
                  className={styles.pinInput}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={4}
                  placeholder="••••"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  disabled={busy || !isOnline}
                />
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={busy || !isOnline || pin.length !== 4}
                  onClick={() => void submitPinAndFinish()}
                >
                  {busy ? 'Finishing…' : 'Verify PIN & complete visit'}
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
