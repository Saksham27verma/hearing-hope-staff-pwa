import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { IoArrowBack } from 'react-icons/io5';
import { auth, db } from '../firebase';
import type { Appointment } from '../types';
import { useAppointmentsContext } from '../context/AppointmentsContext';
import { isPayableAppointmentForPayment } from '../utils/appointmentPayable';
import { getStartForDisplay, formatTime } from '../dateUtils';
import { submitCollectPayment, type PaymentMode, type ReceiptType } from '../api/collectPayment';
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
      setErrorBanner('This appointment cannot be used for payment logging.');
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

      const result = await submitCollectPayment({
        appointmentId: resolved.id,
        amount: n,
        paymentMode,
        receiptType,
        details,
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
          Payment collected today (₹)
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
                        {it.company} · SN {it.serialNumber} · ₹{it.mrp}
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
                    {it.company} · SN {it.serialNumber} · ₹{it.mrp}
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

        <button type="submit" className={styles.submit} disabled={submitting}>
          {submitting ? 'Sending…' : 'Send to admin'}
        </button>
      </form>
    </div>
  );
}
