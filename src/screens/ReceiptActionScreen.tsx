import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { IoArrowBack, IoTrashOutline, IoAddCircleOutline } from 'react-icons/io5';
import { auth, db } from '../firebase';
import type { Appointment } from '../types';
import { useAppointmentsContext } from '../context/AppointmentsContext';
import { isPayableAppointmentForPayment, isEligibleForVisitServicesLogging } from '../utils/appointmentPayable';
import { submitLogVisitServices, type VisitServicesPayload } from '../api/logVisitServices';
import { getStartForDisplay, formatTime } from '../dateUtils';
import { submitCollectPayment, type PaymentMode, type ReceiptType } from '../api/collectPayment';
import {
  htmlTemplateIdForReceiptType,
  loadStaffReceiptTemplateLabels,
  type StaffReceiptTemplateLabels,
} from '../api/receiptTemplateRouting';
import { fetchAvailableInventory, type StaffInventoryRow } from '../api/staffInventory';
import { fetchStaffEnquiryConfig, type FieldOption } from '../api/staffEnquiryConfig';
import { fetchStaffProductsCatalog, type CatalogProduct } from '../api/staffProductsCatalog';
import styles from './ReceiptActionScreen.module.css';

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const FALLBACK_EAR: FieldOption[] = [
  { optionValue: 'left', optionLabel: 'Left', sortOrder: 10 },
  { optionValue: 'right', optionLabel: 'Right', sortOrder: 20 },
  { optionValue: 'both', optionLabel: 'Both', sortOrder: 30 },
];

const FALLBACK_TRIAL_LOC: FieldOption[] = [
  { optionValue: 'in_office', optionLabel: 'In-Office Trial', sortOrder: 10 },
  { optionValue: 'home', optionLabel: 'Home Trial', sortOrder: 20 },
];

type HtEntry = { id: string; testType: string; price: string };

function newHtId() {
  return `ht-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function ReceiptActionScreen() {
  const { appointmentId: appointmentIdParam } = useParams<{ appointmentId: string }>();
  const appointmentId = appointmentIdParam ? decodeURIComponent(appointmentIdParam) : '';
  const navigate = useNavigate();
  const { appointments, isOnline } = useAppointmentsContext();
  const uid = auth.currentUser?.uid;

  const [resolved, setResolved] = useState<Appointment | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [receiptType, setReceiptType] = useState<ReceiptType>('booking');
  const [submitting, setSubmitting] = useState(false);
  const [savingVisitServices, setSavingVisitServices] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [hearingTest, setHearingTest] = useState(false);
  const [htEntries, setHtEntries] = useState<HtEntry[]>([{ id: newHtId(), testType: '', price: '' }]);
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
  const [templateLabels, setTemplateLabels] = useState<StaffReceiptTemplateLabels>({});

  const [earOptions, setEarOptions] = useState<FieldOption[]>(FALLBACK_EAR);
  const [trialLocOptions, setTrialLocOptions] = useState<FieldOption[]>(FALLBACK_TRIAL_LOC);

  const [bookingProduct, setBookingProduct] = useState<CatalogProduct | null>(null);
  const [bookingEar, setBookingEar] = useState('both');
  const [bookingMrp, setBookingMrp] = useState('');
  const [bookingSelling, setBookingSelling] = useState('');
  const [bookingQty, setBookingQty] = useState('1');

  const [trialProduct, setTrialProduct] = useState<CatalogProduct | null>(null);
  const [trialLoc, setTrialLoc] = useState<'in_office' | 'home'>('in_office');
  const [trialEar, setTrialEar] = useState('both');
  const [trialMrp, setTrialMrp] = useState('');
  const [trialDuration, setTrialDuration] = useState('7');
  const [trialStart, setTrialStart] = useState(() => toYmd(new Date()));
  const [trialEnd, setTrialEnd] = useState(() => {
    const e = new Date();
    e.setDate(e.getDate() + 7);
    return toYmd(e);
  });
  const [trialSerial, setTrialSerial] = useState('');
  const [trialDeposit, setTrialDeposit] = useState('');
  const [trialNotes, setTrialNotes] = useState('');

  const [inventoryItems, setInventoryItems] = useState<StaffInventoryRow[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [invSearch, setInvSearch] = useState('');
  const [selectedInv, setSelectedInv] = useState<StaffInventoryRow | null>(null);
  const [saleEar, setSaleEar] = useState('both');
  const [saleSelling, setSaleSelling] = useState('');
  const [saleDiscount, setSaleDiscount] = useState('0');
  const [saleGst, setSaleGst] = useState('18');
  const [saleQty, setSaleQty] = useState('1');

  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogItems, setCatalogItems] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const loadInventory = useCallback(async () => {
    setInventoryLoading(true);
    try {
      const r = await fetchAvailableInventory();
      if (r.ok && r.items) setInventoryItems(r.items);
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const r = await fetchStaffEnquiryConfig();
      if (r.ok) {
        if (r.earSide?.length) setEarOptions(r.earSide);
        if (r.trialLocationType?.length) setTrialLocOptions(r.trialLocationType);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const labels = await loadStaffReceiptTemplateLabels();
        if (!cancelled) setTemplateLabels(labels);
      } catch {
        if (!cancelled) setTemplateLabels({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (receiptType === 'invoice' || (receiptType === 'trial' && trialLoc === 'home')) {
      void loadInventory();
    }
  }, [receiptType, trialLoc, loadInventory]);

  const loadCatalog = useCallback(async (q: string) => {
    setCatalogLoading(true);
    try {
      const r = await fetchStaffProductsCatalog(q);
      if (r.ok && r.products) setCatalogItems(r.products);
      else setCatalogItems([]);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (receiptType !== 'booking' && receiptType !== 'trial') return;
    const t = setTimeout(() => void loadCatalog(catalogSearch), 300);
    return () => clearTimeout(t);
  }, [catalogSearch, loadCatalog, receiptType]);

  const currentPdfTemplate = useMemo(() => {
    if (receiptType === 'booking') return templateLabels.booking;
    if (receiptType === 'trial') return templateLabels.trial;
    return templateLabels.invoice;
  }, [receiptType, templateLabels]);

  const filteredInv = useMemo(() => {
    let base = inventoryItems;
    if (receiptType === 'trial' && trialLoc === 'home' && trialProduct) {
      base = base.filter((it) => it.productId === trialProduct.id);
    }
    const q = invSearch.trim().toLowerCase();
    if (!q) return base.slice(0, 100);
    return base.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        it.company.toLowerCase().includes(q) ||
        it.type.toLowerCase().includes(q) ||
        it.serialNumber.toLowerCase().includes(q)
    );
  }, [inventoryItems, invSearch, receiptType, trialLoc, trialProduct]);

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
      setErrorBanner('This appointment cannot be used for visit details (payment / services).');
    }
  }, [resolved, loading]);

  useEffect(() => {
    if (bookingProduct) {
      const m = String(bookingProduct.mrp ?? 0);
      setBookingMrp(m);
      setBookingSelling(m);
    }
  }, [bookingProduct]);

  useEffect(() => {
    if (trialProduct) {
      setTrialMrp(String(trialProduct.mrp ?? 0));
    }
  }, [trialProduct]);

  useEffect(() => {
    if (trialLoc === 'in_office') {
      setTrialDuration('0');
      setTrialStart('');
      setTrialEnd('');
      setTrialSerial('');
      setTrialDeposit('0');
    } else {
      setTrialDuration((d) => (d === '0' ? '7' : d));
      if (!trialStart) setTrialStart(toYmd(new Date()));
    }
  }, [trialLoc]);

  useEffect(() => {
    const d = Number(trialDuration);
    const start = trialStart.trim();
    if (trialLoc === 'home' && Number.isFinite(d) && d > 0 && start) {
      const sd = new Date(start + 'T12:00:00');
      if (!Number.isNaN(sd.getTime())) {
        const ed = new Date(sd.getTime() + d * 24 * 60 * 60 * 1000);
        setTrialEnd(toYmd(ed));
      }
    }
  }, [trialDuration, trialStart, trialLoc]);

  useEffect(() => {
    if (selectedInv) {
      setSaleSelling(String(selectedInv.mrp || 0));
    }
  }, [selectedInv]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount.replace(/,/g, '').trim());
    if (!Number.isFinite(n) || n <= 0) {
      setErrorBanner('Enter a positive amount (payment collected today).');
      return;
    }
    if (!resolved?.id) return;

    if (receiptType === 'booking') {
      if (!bookingProduct) {
        setErrorBanner('Select a device from the product catalog (same as CRM).');
        return;
      }
      const mrp = Number(bookingMrp);
      const sell = Number(bookingSelling);
      const qty = Number(bookingQty);
      if (!Number.isFinite(mrp) || mrp < 0 || !Number.isFinite(sell) || sell < 0) {
        setErrorBanner('Enter valid MRP and selling price.');
        return;
      }
      if (!Number.isFinite(qty) || qty < 1) {
        setErrorBanner('Enter quantity at least 1.');
        return;
      }
    }

    if (receiptType === 'trial') {
      if (!trialProduct) {
        setErrorBanner('Select a device from the product catalog (same as CRM).');
        return;
      }
      const mrp = Number(trialMrp);
      if (!Number.isFinite(mrp) || mrp < 0) {
        setErrorBanner('Enter MRP per unit.');
        return;
      }
      if (trialLoc === 'home') {
        const dur = Number(trialDuration);
        if (!Number.isFinite(dur) || dur < 1) {
          setErrorBanner('Enter trial duration (home trial).');
          return;
        }
        if (!trialStart.trim() || !trialEnd.trim()) {
          setErrorBanner('Enter trial start and end dates.');
          return;
        }
        if (!trialSerial.trim()) {
          setErrorBanner('Pick an inventory serial for home trial.');
          return;
        }
        const dep = Number(trialDeposit);
        if (!Number.isFinite(dep) || dep < 0) {
          setErrorBanner('Enter security deposit.');
          return;
        }
      }
    }

    if (receiptType === 'invoice') {
      if (!selectedInv) {
        setErrorBanner('Select a hearing aid from inventory.');
        return;
      }
      const sp = Number(saleSelling);
      const disc = Number(saleDiscount);
      const gst = Number(saleGst);
      const qty = Number(saleQty);
      if (!Number.isFinite(sp) || sp < 0) {
        setErrorBanner('Enter selling price.');
        return;
      }
      if (!Number.isFinite(disc) || disc < 0 || disc > 100 || !Number.isFinite(gst) || gst < 0) {
        setErrorBanner('Check discount and GST %.');
        return;
      }
      if (!Number.isFinite(qty) || qty < 1) {
        setErrorBanner('Enter quantity.');
        return;
      }
    }

    setSubmitting(true);
    setErrorBanner(null);
    try {
      const details =
        receiptType === 'booking'
          ? {
              booking: {
                catalogProductId: bookingProduct!.id,
                whichEar: bookingEar as 'left' | 'right' | 'both',
                hearingAidPrice: Number(bookingMrp),
                bookingSellingPrice: Number(bookingSelling),
                bookingQuantity: Math.max(1, Math.floor(Number(bookingQty) || 1)),
              },
            }
          : receiptType === 'trial'
            ? {
                trial: {
                  catalogProductId: trialProduct!.id,
                  trialLocationType: trialLoc,
                  whichEar: trialEar as 'left' | 'right' | 'both',
                  hearingAidPrice: Number(trialMrp),
                  trialDuration: trialLoc === 'home' ? Math.max(1, Math.floor(Number(trialDuration) || 1)) : 0,
                  trialStartDate: trialLoc === 'home' ? trialStart.trim() : '',
                  trialEndDate: trialLoc === 'home' ? trialEnd.trim() : '',
                  trialSerialNumber: trialLoc === 'home' ? trialSerial.trim() : '',
                  trialHomeSecurityDepositAmount: trialLoc === 'home' ? Number(trialDeposit) : 0,
                  trialNotes: trialNotes.trim(),
                },
              }
            : {
                sale: {
                  productId: selectedInv!.productId,
                  name: selectedInv!.name,
                  company: selectedInv!.company,
                  serialNumber: selectedInv!.serialNumber,
                  mrp: selectedInv!.mrp,
                  sellingPrice: Number(saleSelling),
                  discountPercent: Number(saleDiscount),
                  gstPercent: Number(saleGst),
                  quantity: Math.max(1, Math.floor(Number(saleQty) || 1)),
                  whichEar: saleEar as 'left' | 'right' | 'both',
                },
              };

      const htmlTemplateId = htmlTemplateIdForReceiptType(templateLabels, receiptType);
      const result = await submitCollectPayment({
        appointmentId: resolved.id,
        amount: n,
        paymentMode,
        receiptType,
        details,
        ...(htmlTemplateId ? { htmlTemplateId } : {}),
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

  const buildVisitServicesPayload = (): { ok: true; services: VisitServicesPayload } | { ok: false; message: string } => {
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
      return { ok: false, message: 'Turn on at least one service, or skip this section.' };
    }
    return { ok: true, services };
  };

  const handleSaveVisitServices = async () => {
    if (!resolved?.id) return;
    if (!isOnline) {
      setErrorBanner('Visit logging requires an internet connection.');
      return;
    }
    if (!resolved.enquiryId?.trim()) {
      setErrorBanner('Link this appointment to an enquiry in CRM to save visit services.');
      return;
    }
    if (!isEligibleForVisitServicesLogging(resolved)) {
      setErrorBanner('Visit services cannot be saved for this appointment.');
      return;
    }
    const built = buildVisitServicesPayload();
    if (!built.ok) {
      setErrorBanner(built.message);
      return;
    }
    setSavingVisitServices(true);
    setErrorBanner(null);
    try {
      const r = await submitLogVisitServices({
        appointmentId: resolved.id,
        services: built.services,
      });
      if (!r.ok) {
        setErrorBanner(r.error || 'Failed to save');
        return;
      }
      alert('Visit services were logged to the enquiry.');
    } catch (e: unknown) {
      setErrorBanner(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSavingVisitServices(false);
    }
  };

  const visitFormBusy = submitting || savingVisitServices;

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
          <h1 className={styles.title}>Visit details</h1>
        </header>
        {errorBanner ? <p className={styles.errorText}>{errorBanner}</p> : null}
      </div>
    );
  }

  const typeLabel = resolved.type === 'home' ? 'Home visit' : 'Center';
  const startIso = getStartForDisplay(resolved.start);
  const showVisitServicesForm =
    !!(resolved.enquiryId || '').trim() && isEligibleForVisitServicesLogging(resolved);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <IoArrowBack size={22} />
        </button>
        <h1 className={styles.title}>Visit details</h1>
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

        <h2 className={styles.visitBlockTitle}>Visit services (CRM)</h2>
        <p className={styles.visitHint}>
          Log tests, accessories, programming, and counselling. Requires internet. Link an enquiry in CRM if missing.
        </p>
        {!resolved.enquiryId?.trim() ? (
          <p className={styles.visitMuted}>No enquiry linked — connect this appointment in CRM to save visit services.</p>
        ) : !showVisitServicesForm ? (
          <p className={styles.visitMuted}>Visit services are not available for this appointment.</p>
        ) : (
          <>
            <section className={styles.card}>
              <div className={styles.vsRowBetween}>
                <span className={styles.vsSectionTitle}>Hearing test</span>
                <input
                  type="checkbox"
                  checked={hearingTest}
                  onChange={(e) => setHearingTest(e.target.checked)}
                  disabled={visitFormBusy}
                  aria-label="Hearing test"
                />
              </div>
              {hearingTest ? (
                <>
                  {htEntries.map((row) => (
                    <div key={row.id} className={styles.vsHtRow}>
                      <input
                        className={styles.vsInput}
                        placeholder="Test type"
                        value={row.testType}
                        disabled={visitFormBusy}
                        onChange={(e) => {
                          const next = [...htEntries];
                          const idx = next.findIndex((r) => r.id === row.id);
                          if (idx >= 0) next[idx] = { ...row, testType: e.target.value };
                          setHtEntries(next);
                        }}
                      />
                      <input
                        className={`${styles.vsInput} ${styles.vsPriceInput}`}
                        placeholder="₹"
                        inputMode="decimal"
                        value={row.price}
                        disabled={visitFormBusy}
                        onChange={(e) => {
                          const next = [...htEntries];
                          const idx = next.findIndex((r) => r.id === row.id);
                          if (idx >= 0) next[idx] = { ...row, price: e.target.value };
                          setHtEntries(next);
                        }}
                      />
                      <button
                        type="button"
                        className={styles.vsTrashBtn}
                        disabled={htEntries.length <= 1 || visitFormBusy}
                        onClick={() => setHtEntries((prev) => prev.filter((r) => r.id !== row.id))}
                        aria-label="Remove row"
                      >
                        <IoTrashOutline size={22} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={styles.vsAddRow}
                    disabled={visitFormBusy}
                    onClick={() => setHtEntries((prev) => [...prev, { id: newHtId(), testType: '', price: '' }])}
                  >
                    <IoAddCircleOutline size={18} />
                    Add test line
                  </button>
                  <VsField label="Test done by" value={testDoneBy} onChange={setTestDoneBy} disabled={visitFormBusy} />
                  <VsField label="Test results" value={testResults} onChange={setTestResults} multiline disabled={visitFormBusy} />
                  <VsField
                    label="Recommendations"
                    value={recommendations}
                    onChange={setRecommendations}
                    multiline
                    disabled={visitFormBusy}
                  />
                </>
              ) : null}
            </section>

            <section className={styles.card}>
              <div className={styles.vsRowBetween}>
                <span className={styles.vsSectionTitle}>Accessory</span>
                <input
                  type="checkbox"
                  checked={accessory}
                  onChange={(e) => setAccessory(e.target.checked)}
                  disabled={visitFormBusy}
                  aria-label="Accessory"
                />
              </div>
              {accessory ? (
                <>
                  <VsField label="Accessory name *" value={accessoryName} onChange={setAccessoryName} disabled={visitFormBusy} />
                  <VsField label="Details" value={accessoryDetails} onChange={setAccessoryDetails} multiline disabled={visitFormBusy} />
                  <div className={styles.vsRowBetween}>
                    <span className={styles.vsSectionTitle}>Free of charge</span>
                    <input
                      type="checkbox"
                      checked={accessoryFOC}
                      onChange={(e) => setAccessoryFOC(e.target.checked)}
                      disabled={visitFormBusy}
                    />
                  </div>
                  <VsField label="Amount (₹)" value={accessoryAmount} onChange={setAccessoryAmount} inputMode="decimal" disabled={visitFormBusy} />
                  <VsField label="Quantity" value={accessoryQuantity} onChange={setAccessoryQuantity} inputMode="numeric" disabled={visitFormBusy} />
                </>
              ) : null}
            </section>

            <section className={styles.card}>
              <div className={styles.vsRowBetween}>
                <span className={styles.vsSectionTitle}>Programming</span>
                <input
                  type="checkbox"
                  checked={programming}
                  onChange={(e) => setProgramming(e.target.checked)}
                  disabled={visitFormBusy}
                  aria-label="Programming"
                />
              </div>
              {programming ? (
                <>
                  <VsField label="Reason" value={programmingReason} onChange={setProgrammingReason} multiline disabled={visitFormBusy} />
                  <VsField label="Amount (₹)" value={programmingAmount} onChange={setProgrammingAmount} inputMode="decimal" disabled={visitFormBusy} />
                  <VsField label="Done by" value={programmingDoneBy} onChange={setProgrammingDoneBy} disabled={visitFormBusy} />
                  <VsField label="HA purchase date" value={hearingAidPurchaseDate} onChange={setHearingAidPurchaseDate} disabled={visitFormBusy} />
                  <VsField label="Hearing aid name" value={hearingAidName} onChange={setHearingAidName} disabled={visitFormBusy} />
                  <div className={styles.vsRowBetween}>
                    <span className={styles.vsSectionTitle}>Under warranty</span>
                    <input
                      type="checkbox"
                      checked={underWarranty}
                      onChange={(e) => setUnderWarranty(e.target.checked)}
                      disabled={visitFormBusy}
                    />
                  </div>
                  <VsField label="Warranty" value={warranty} onChange={setWarranty} disabled={visitFormBusy} />
                </>
              ) : null}
            </section>

            <section className={styles.card}>
              <div className={styles.vsRowBetween}>
                <span className={styles.vsSectionTitle}>Counselling</span>
                <input
                  type="checkbox"
                  checked={counselling}
                  onChange={(e) => setCounselling(e.target.checked)}
                  disabled={visitFormBusy}
                  aria-label="Counselling"
                />
              </div>
              {counselling ? (
                <VsField label="Notes" value={counsellingNotes} onChange={setCounsellingNotes} multiline disabled={visitFormBusy} />
              ) : null}
            </section>

            <button
              type="button"
              className={styles.visitSaveOutline}
              disabled={visitFormBusy}
              onClick={() => void handleSaveVisitServices()}
            >
              {savingVisitServices ? 'Saving…' : 'Save visit services'}
            </button>
          </>
        )}

        <h2 className={styles.visitBlockTitle}>Payment & receipt</h2>
        <p className={styles.visitHint}>Collect payment for trial, booking, or sale — request goes to admin for verification.</p>

        <label className={styles.label} htmlFor="amount">
          Payment collected today (₹)
        </label>
        <input
          id="amount"
          className={styles.input}
          inputMode="decimal"
          placeholder="0"
          value={amount}
          onChange={(ev) => setAmount(ev.target.value)}
          disabled={visitFormBusy}
        />

        <p className={styles.label}>Payment mode</p>
        <div className={styles.chips}>
          {(['cash', 'upi', 'card'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`${styles.chip} ${paymentMode === m ? styles.chipActive : ''}`}
              onClick={() => setPaymentMode(m)}
              disabled={visitFormBusy}
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
              disabled={visitFormBusy}
            >
              {t}
            </button>
          ))}
        </div>

        <div className={styles.card}>
          <p className={styles.sectionLabel}>PDF template (CRM)</p>
          {currentPdfTemplate ? (
            <>
              <p className={styles.meta} style={{ marginTop: 0 }}>
                <span className={styles.templateStrong}>{currentPdfTemplate.name}</span>
              </p>
              <p className={styles.templateMono}>ID: {currentPdfTemplate.id}</p>
              <p className={styles.templateHint}>
                This template is pinned in CRM Invoice Manager. Its ID is sent with your request so the PDF matches what
                admins see there.
              </p>
            </>
          ) : (
            <p className={styles.meta} style={{ marginTop: 0 }}>
              No template pinned for this receipt type in CRM. The server will choose a default HTML template (same as
              before Invoice Manager routing).
            </p>
          )}
        </div>

        {receiptType === 'booking' ? (
          <div className={styles.block}>
            <h2 className={styles.blockTitle}>Booking — catalog (CRM)</h2>
            <label className={styles.label}>Search product catalog</label>
            <input
              className={styles.input}
              placeholder="Company, model, type"
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
            />
            {catalogLoading ? <p className={styles.meta}>Loading…</p> : null}
            <div className={styles.invList}>
              {catalogItems.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className={`${styles.invRow} ${bookingProduct?.id === it.id ? styles.invRowActive : ''}`}
                  onClick={() => setBookingProduct(it)}
                >
                  <span className={styles.invName}>{it.name}</span>
                  <span className={styles.invSub}>
                    {it.company} · {it.type} · ₹{it.mrp ?? 0}
                  </span>
                </button>
              ))}
            </div>
            {bookingProduct ? (
              <p className={styles.meta}>Selected: {bookingProduct.company} · {bookingProduct.name}</p>
            ) : null}
            <p className={styles.label}>Which ear</p>
            <div className={styles.chips}>
              {earOptions.map((o) => (
                <button
                  key={o.optionValue}
                  type="button"
                  className={`${styles.chip} ${bookingEar === o.optionValue ? styles.chipActive : ''}`}
                  onClick={() => setBookingEar(o.optionValue)}
                >
                  {o.optionLabel}
                </button>
              ))}
            </div>
            <label className={styles.label}>MRP (per unit) ₹</label>
            <input className={styles.input} inputMode="decimal" value={bookingMrp} onChange={(e) => setBookingMrp(e.target.value)} />
            <label className={styles.label}>Selling price (per unit) ₹</label>
            <input
              className={styles.input}
              inputMode="decimal"
              value={bookingSelling}
              onChange={(e) => setBookingSelling(e.target.value)}
            />
            <label className={styles.label}>Quantity</label>
            <input className={styles.input} inputMode="numeric" value={bookingQty} onChange={(e) => setBookingQty(e.target.value)} />
          </div>
        ) : null}

        {receiptType === 'trial' ? (
          <div className={styles.block}>
            <h2 className={styles.blockTitle}>Trial — catalog + trial type (CRM)</h2>
            <label className={styles.label}>Search product catalog</label>
            <input
              className={styles.input}
              placeholder="Company, model, type"
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
            />
            {catalogLoading ? <p className={styles.meta}>Loading…</p> : null}
            <div className={styles.invList}>
              {catalogItems.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className={`${styles.invRow} ${trialProduct?.id === it.id ? styles.invRowActive : ''}`}
                  onClick={() => setTrialProduct(it)}
                >
                  <span className={styles.invName}>{it.name}</span>
                  <span className={styles.invSub}>
                    {it.company} · {it.type} · ₹{it.mrp ?? 0}
                  </span>
                </button>
              ))}
            </div>
            <p className={styles.label}>Trial type</p>
            <div className={styles.chips}>
              {trialLocOptions.map((o) => {
                const v = (o.optionValue === 'home' ? 'home' : 'in_office') as 'in_office' | 'home';
                return (
                  <button
                    key={o.optionValue}
                    type="button"
                    className={`${styles.chip} ${trialLoc === v ? styles.chipActive : ''}`}
                    onClick={() => setTrialLoc(v)}
                  >
                    {o.optionLabel}
                  </button>
                );
              })}
            </div>
            <p className={styles.label}>Which ear</p>
            <div className={styles.chips}>
              {earOptions.map((o) => (
                <button
                  key={o.optionValue}
                  type="button"
                  className={`${styles.chip} ${trialEar === o.optionValue ? styles.chipActive : ''}`}
                  onClick={() => setTrialEar(o.optionValue)}
                >
                  {o.optionLabel}
                </button>
              ))}
            </div>
            <label className={styles.label}>MRP (per unit) ₹</label>
            <input className={styles.input} inputMode="decimal" value={trialMrp} onChange={(e) => setTrialMrp(e.target.value)} />
            {trialLoc === 'home' ? (
              <>
                <label className={styles.label}>Trial period (days)</label>
                <input className={styles.input} inputMode="numeric" value={trialDuration} onChange={(e) => setTrialDuration(e.target.value)} />
                <label className={styles.label}>Trial start (YYYY-MM-DD)</label>
                <input className={styles.input} value={trialStart} onChange={(e) => setTrialStart(e.target.value)} />
                <label className={styles.label}>Trial end (YYYY-MM-DD)</label>
                <input className={styles.input} value={trialEnd} onChange={(e) => setTrialEnd(e.target.value)} />
                <label className={styles.label}>Inventory serial (home trial)</label>
                {inventoryLoading ? <p className={styles.meta}>Loading inventory…</p> : null}
                <input
                  className={styles.input}
                  placeholder="Filter serials"
                  value={invSearch}
                  onChange={(e) => setInvSearch(e.target.value)}
                />
                <div className={styles.invList}>
                  {filteredInv.map((it) => (
                    <button
                      key={it.lineId}
                      type="button"
                      className={`${styles.invRow} ${trialSerial === it.serialNumber ? styles.invRowActive : ''}`}
                      onClick={() => setTrialSerial(it.serialNumber)}
                    >
                      <span className={styles.invName}>{it.name}</span>
                      <span className={styles.invSub}>
                        {it.company} · {it.type} · SN {it.serialNumber} · ₹{it.mrp}
                      </span>
                    </button>
                  ))}
                </div>
                <label className={styles.label}>Security deposit ₹</label>
                <input className={styles.input} inputMode="decimal" value={trialDeposit} onChange={(e) => setTrialDeposit(e.target.value)} />
              </>
            ) : null}
            <label className={styles.label}>Trial notes</label>
            <textarea className={styles.textarea} value={trialNotes} onChange={(e) => setTrialNotes(e.target.value)} rows={3} />
          </div>
        ) : null}

        {receiptType === 'invoice' ? (
          <div className={styles.block}>
            <h2 className={styles.blockTitle}>Sale — inventory (CRM)</h2>
            <p className={styles.label}>Which ear</p>
            <div className={styles.chips}>
              {earOptions.map((o) => (
                <button
                  key={o.optionValue}
                  type="button"
                  className={`${styles.chip} ${saleEar === o.optionValue ? styles.chipActive : ''}`}
                  onClick={() => setSaleEar(o.optionValue)}
                >
                  {o.optionLabel}
                </button>
              ))}
            </div>
            {inventoryLoading ? <p className={styles.meta}>Loading inventory…</p> : null}
            <label className={styles.label}>Search & select serial</label>
            <input
              className={styles.input}
              placeholder="Filter by name, company, serial"
              value={invSearch}
              onChange={(e) => setInvSearch(e.target.value)}
            />
            <div className={styles.invList}>
              {filteredInv.map((it) => (
                <button
                  key={it.lineId}
                  type="button"
                  className={`${styles.invRow} ${selectedInv?.lineId === it.lineId ? styles.invRowActive : ''}`}
                  onClick={() => setSelectedInv(it)}
                >
                  <span className={styles.invName}>{it.name}</span>
                  <span className={styles.invSub}>
                    {it.company} · {it.type} · SN {it.serialNumber} · ₹{it.mrp}
                  </span>
                </button>
              ))}
            </div>
            {selectedInv ? (
              <>
                <label className={styles.label}>Selling price (per unit) ₹</label>
                <input className={styles.input} inputMode="decimal" value={saleSelling} onChange={(e) => setSaleSelling(e.target.value)} />
                <label className={styles.label}>Discount %</label>
                <input className={styles.input} inputMode="decimal" value={saleDiscount} onChange={(e) => setSaleDiscount(e.target.value)} />
                <label className={styles.label}>GST %</label>
                <input className={styles.input} inputMode="decimal" value={saleGst} onChange={(e) => setSaleGst(e.target.value)} />
                <label className={styles.label}>Quantity</label>
                <input className={styles.input} inputMode="numeric" value={saleQty} onChange={(e) => setSaleQty(e.target.value)} />
              </>
            ) : null}
          </div>
        ) : null}

        <button type="submit" className={styles.submit} disabled={visitFormBusy}>
          {submitting ? 'Sending…' : 'Send payment to admin'}
        </button>
      </form>
    </div>
  );
}

function VsField({
  label,
  value,
  onChange,
  multiline,
  inputMode,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  disabled?: boolean;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.vsFieldLabel}>{label}</label>
      {multiline ? (
        <textarea
          className={`${styles.input} ${styles.vsTextarea}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={4}
        />
      ) : (
        <input
          className={styles.input}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={inputMode}
          disabled={disabled}
        />
      )}
    </div>
  );
}
