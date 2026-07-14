import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, HTMLAttributes } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { ArrowLeft, ChevronDown, ChevronRight, CirclePlus, List, Trash2 } from 'lucide-react';
import { auth, db } from '../firebase';
import type { Appointment } from '../types';
import { useAppointmentsContext } from '../context/AppointmentsContext';
import { isEligibleForPaymentToAdmin, isEligibleForVisitServicesLogging, isEligibleForCheckoutCommerceStaging, canOpenVisitWorkspace } from '../utils/appointmentPayable';
import { submitLogVisitServices, type VisitServicesPayload } from '../api/logVisitServices';
import { getStartForDisplay, formatTime } from '../dateUtils';
import { submitCollectPayment, type PaymentMode, type ReceiptType } from '../api/collectPayment';
import { saveCheckoutDraft } from '../api/visitCompliance';
import {
  htmlTemplateIdForReceiptType,
  loadStaffReceiptTemplateLabels,
  type StaffReceiptTemplateLabels,
} from '../api/receiptTemplateRouting';
import { fetchAvailableInventory, type StaffInventoryRow } from '../api/staffInventory';
import { fetchStaffEnquiryConfig, type FieldOption } from '../api/staffEnquiryConfig';
import { fetchStaffProductsCatalog, type CatalogProduct } from '../api/staffProductsCatalog';
import {
  derivedDiscountPercentFromMrpSelling,
  effectiveGstPercentFromInventoryRow,
  HEARING_AID_SALE_WARRANTY_OPTIONS,
  lineInclusiveTotal,
  roundInrRupee,
} from '../utils/saleLineMath';
import ProductPickSheet from '../components/ProductPickSheet';
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

const ACCESSORY_CATALOG_TYPES = ['Accessory', 'Battery', 'Charger', 'Other'] as const;

function isAccessoryCatalogProduct(p: CatalogProduct): boolean {
  return (ACCESSORY_CATALOG_TYPES as readonly string[]).includes(p.type);
}

type HtEntry = { id: string; testType: string; price: string; testTypeCustom?: boolean };

function newHtId() {
  return `ht-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

type BookingLineDraft = {
  id: string;
  product: CatalogProduct;
  mrp: string;
  selling: string;
  qty: string;
};

type TrialModelDraft = {
  id: string;
  product: CatalogProduct;
  mrp: string;
  serial: string;
};

type SaleLineDraft = {
  id: string;
  inv: StaffInventoryRow | null;
  sellingPrice: string;
  gstPercent: string;
  qty: string;
  warranty: string;
};

function newSaleLineId() {
  return `sl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function newBookingLineId() {
  return `bk-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function newTrialModelId() {
  return `tm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function ReceiptActionScreen() {
  const { appointmentId: appointmentIdParam } = useParams<{ appointmentId: string }>();
  const appointmentId = appointmentIdParam ? decodeURIComponent(appointmentIdParam) : '';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromCheckout = searchParams.get('from') === 'checkout';
  const modeParam = (searchParams.get('mode') || '').toLowerCase();
  const draftMode = searchParams.get('draft') === '1';
  const goBack = () => {
    if (fromCheckout && appointmentId) {
      navigate(`/app/visit/${encodeURIComponent(appointmentId)}/compliance`);
      return;
    }
    if (modeParam === 'payment' && appointmentId) {
      navigate('/app', { replace: true });
      return;
    }
    navigate(-1);
  };
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
  const [htEntries, setHtEntries] = useState<HtEntry[]>([
    { id: newHtId(), testType: '', price: '', testTypeCustom: false },
  ]);
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
  const [hearingTestTypeOptions, setHearingTestTypeOptions] = useState<FieldOption[]>([]);
  const [staffNames, setStaffNames] = useState<string[]>([]);

  const [selectModal, setSelectModal] = useState<
    null | { kind: 'ht'; rowId: string } | { kind: 'staff_test' } | { kind: 'staff_prog' }
  >(null);
  const [optionSearch, setOptionSearch] = useState('');
  const [staffCustomDraft, setStaffCustomDraft] = useState('');

  const [accessoryCatalogModal, setAccessoryCatalogModal] = useState(false);
  const [accessoryCatalogSearch, setAccessoryCatalogSearch] = useState('');
  const [accessoryCatalogItems, setAccessoryCatalogItems] = useState<CatalogProduct[]>([]);
  const [accessoryCatalogLoading, setAccessoryCatalogLoading] = useState(false);

  const [vsOpen, setVsOpen] = useState({ ht: true, acc: false, prog: false, cou: false });

  const toggleVs = useCallback((key: 'ht' | 'acc' | 'prog' | 'cou') => {
    setVsOpen((o) => ({ ...o, [key]: !o[key] }));
  }, []);

  const [bookingLines, setBookingLines] = useState<BookingLineDraft[]>([]);
  const [bookingEar, setBookingEar] = useState('both');

  const [trialModels, setTrialModels] = useState<TrialModelDraft[]>([]);
  const [trialLoc, setTrialLoc] = useState<'in_office' | 'home'>('in_office');
  const [trialEar, setTrialEar] = useState('both');
  const [trialDuration, setTrialDuration] = useState('7');
  const [trialStart, setTrialStart] = useState(() => toYmd(new Date()));
  const [trialEnd, setTrialEnd] = useState(() => {
    const e = new Date();
    e.setDate(e.getDate() + 7);
    return toYmd(e);
  });
  const [trialDeposit, setTrialDeposit] = useState('');
  const [trialNotes, setTrialNotes] = useState('');
  /** Which trial model row is picking a serial (home trial). */
  const [trialSerialPickId, setTrialSerialPickId] = useState<string | null>(null);

  const [inventoryItems, setInventoryItems] = useState<StaffInventoryRow[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [invSearch, setInvSearch] = useState('');
  const [saleLines, setSaleLines] = useState<SaleLineDraft[]>([]);
  const [saleEar, setSaleEar] = useState('both');

  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogItems, setCatalogItems] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  type PickerMode = null | 'bookingCatalog' | 'trialCatalog' | 'saleStock' | 'trialStock';
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);

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
        if (r.hearingTestType?.length) setHearingTestTypeOptions(r.hearingTestType);
        if (r.staffNames?.length) setStaffNames(r.staffNames);
      }
    })();
  }, []);

  useEffect(() => {
    if (hearingTest) setVsOpen((o) => ({ ...o, ht: true }));
  }, [hearingTest]);
  useEffect(() => {
    if (accessory) setVsOpen((o) => ({ ...o, acc: true }));
  }, [accessory]);
  useEffect(() => {
    if (programming) setVsOpen((o) => ({ ...o, prog: true }));
  }, [programming]);
  useEffect(() => {
    if (counselling) setVsOpen((o) => ({ ...o, cou: true }));
  }, [counselling]);

  useEffect(() => {
    if (selectModal) {
      setOptionSearch('');
      setStaffCustomDraft('');
    }
  }, [selectModal]);

  const loadAccessoryCatalog = useCallback(async (q: string) => {
    setAccessoryCatalogLoading(true);
    try {
      const r = await fetchStaffProductsCatalog(q);
      if (r.ok && r.products) {
        setAccessoryCatalogItems(r.products.filter(isAccessoryCatalogProduct));
      } else setAccessoryCatalogItems([]);
    } finally {
      setAccessoryCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessoryCatalogModal) return;
    const delay = accessoryCatalogSearch.trim() ? 300 : 0;
    const t = setTimeout(() => void loadAccessoryCatalog(accessoryCatalogSearch), delay);
    return () => clearTimeout(t);
  }, [accessoryCatalogModal, accessoryCatalogSearch, loadAccessoryCatalog]);

  const filteredHtOptions = useMemo(() => {
    const q = optionSearch.trim().toLowerCase();
    const base = [...hearingTestTypeOptions].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    if (!q) return base;
    return base.filter(
      (o) => o.optionLabel.toLowerCase().includes(q) || o.optionValue.toLowerCase().includes(q)
    );
  }, [hearingTestTypeOptions, optionSearch]);

  const filteredStaffModal = useMemo(() => {
    const q = optionSearch.trim().toLowerCase();
    if (!q) return staffNames;
    return staffNames.filter((s) => s.toLowerCase().includes(q));
  }, [staffNames, optionSearch]);

  const resolveHtLabel = useCallback(
    (row: HtEntry) => {
      if (row.testTypeCustom) return row.testType.trim() || 'Custom type';
      const o = hearingTestTypeOptions.find((x) => x.optionValue === row.testType);
      return o?.optionLabel || row.testType || 'Select test type';
    },
    [hearingTestTypeOptions]
  );

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
    if (receiptType !== 'booking' && receiptType !== 'trial' && pickerMode !== 'bookingCatalog' && pickerMode !== 'trialCatalog') {
      return;
    }
    const t = setTimeout(() => void loadCatalog(catalogSearch), 250);
    return () => clearTimeout(t);
  }, [catalogSearch, loadCatalog, receiptType, pickerMode]);

  const currentPdfTemplate = useMemo(() => {
    if (receiptType === 'booking') return templateLabels.booking;
    if (receiptType === 'trial') return templateLabels.trial;
    return templateLabels.invoice;
  }, [receiptType, templateLabels]);

  const suggestedBookingTotal = useMemo(() => {
    let sum = 0;
    for (const line of bookingLines) {
      const sell = Number(line.selling) || 0;
      const qty = Math.max(1, Math.floor(Number(line.qty) || 1));
      sum += sell * qty;
    }
    return roundInrRupee(sum);
  }, [bookingLines]);

  const suggestedInvoiceTotal = useMemo(() => {
    let sum = 0;
    for (const line of saleLines) {
      if (!line.inv) continue;
      const sp = parseFloat(line.sellingPrice.replace(/,/g, '')) || 0;
      const gst = parseFloat(line.gstPercent) || 0;
      const qty = Math.max(1, Math.floor(parseFloat(line.qty) || 1));
      sum += lineInclusiveTotal(line.inv.mrp, sp, gst, qty);
    }
    return roundInrRupee(sum);
  }, [saleLines]);

  useEffect(() => {
    if (receiptType !== 'booking') return;
    if (suggestedBookingTotal > 0) setAmount(String(suggestedBookingTotal));
  }, [receiptType, suggestedBookingTotal]);

  useEffect(() => {
    if (receiptType !== 'invoice') return;
    if (suggestedInvoiceTotal > 0) setAmount(String(suggestedInvoiceTotal));
  }, [receiptType, suggestedInvoiceTotal]);

  /** One empty line by default so staff can pick serial immediately (multi-line invoice). */
  useEffect(() => {
    if (receiptType !== 'invoice') return;
    setSaleLines((prev) => {
      if (prev.length > 0) return prev;
      return [
        {
          id: newSaleLineId(),
          inv: null,
          sellingPrice: '',
          gstPercent: '18',
          qty: '1',
          warranty: '',
        },
      ];
    });
  }, [receiptType]);

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

      if (fromCache && canOpenVisitWorkspace(fromCache)) {
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
        if (!mine || !canOpenVisitWorkspace(apt)) {
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
      setErrorBanner('This appointment cannot be used for visit services or payment right now.');
    }
  }, [resolved, loading]);

  const screenMode = useMemo((): 'services' | 'payment' | 'both' => {
    if (!resolved) return 'both';
    if (modeParam === 'payment') return 'payment';
    if (modeParam === 'services') return 'services';
    if (fromCheckout) return 'services';
    if (resolved.type === 'home') {
      if (isEligibleForPaymentToAdmin(resolved)) return 'payment';
      return 'services';
    }
    return 'both';
  }, [resolved, modeParam, fromCheckout]);

  const showServicesSection =
    (screenMode === 'services' || screenMode === 'both') &&
    !!resolved &&
    isEligibleForVisitServicesLogging(resolved);
  const showPaymentSection =
    (screenMode === 'payment' || screenMode === 'both') &&
    !!resolved &&
    (draftMode
      ? isEligibleForCheckoutCommerceStaging(resolved) || isEligibleForPaymentToAdmin(resolved)
      : isEligibleForPaymentToAdmin(resolved));

  useEffect(() => {
    if (trialLoc === 'in_office') {
      setTrialDuration('0');
      setTrialStart('');
      setTrialEnd('');
      setTrialDeposit('0');
      setTrialModels((prev) => prev.map((m) => ({ ...m, serial: '' })));
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!resolved?.id) return;
    if (!isEligibleForPaymentToAdmin(resolved) && !(draftMode && isEligibleForCheckoutCommerceStaging(resolved))) {
      setErrorBanner(
        resolved.type === 'home'
          ? draftMode
            ? 'Booking, trial, and sale can be filled during checkout before the telecaller PIN.'
            : 'Complete the home visit checkout first. Booking, trial, and sale can only be sent to admin after the visit is finished.'
          : 'Payment cannot be sent for this appointment right now.'
      );
      return;
    }
    const n = Number(amount.replace(/,/g, '').trim());
    if (!Number.isFinite(n) || n <= 0) {
      setErrorBanner('Enter a positive amount (payment collected today).');
      return;
    }

    if (receiptType === 'booking') {
      if (bookingLines.length === 0) {
        setErrorBanner('Select at least one product for booking.');
        return;
      }
      for (const line of bookingLines) {
        const mrp = Number(line.mrp);
        const sell = Number(line.selling);
        const qty = Number(line.qty);
        if (!Number.isFinite(mrp) || mrp < 0 || !Number.isFinite(sell) || sell < 0) {
          setErrorBanner(`Enter valid MRP and selling for ${line.product.name}.`);
          return;
        }
        if (!Number.isFinite(qty) || qty < 1) {
          setErrorBanner(`Enter quantity at least 1 for ${line.product.name}.`);
          return;
        }
      }
    }

    if (receiptType === 'trial') {
      if (trialModels.length === 0) {
        setErrorBanner('Select at least one trial model (up to 2).');
        return;
      }
      if (trialModels.length > 2) {
        setErrorBanner('Maximum 2 trial models.');
        return;
      }
      for (const m of trialModels) {
        const mrp = Number(m.mrp);
        if (!Number.isFinite(mrp) || mrp < 0) {
          setErrorBanner(`Enter MRP for ${m.product.name}.`);
          return;
        }
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
        for (const m of trialModels) {
          if (!m.serial.trim()) {
            setErrorBanner(`Pick a stock serial for ${m.product.name}.`);
            return;
          }
        }
        const dep = Number(trialDeposit);
        if (!Number.isFinite(dep) || dep < 0) {
          setErrorBanner('Enter security deposit.');
          return;
        }
      }
    }

    if (receiptType === 'invoice') {
      const filled = saleLines.filter((l) => l.inv);
      if (filled.length === 0) {
        setErrorBanner('Add at least one line and pick inventory (serial) for each.');
        return;
      }
      for (const line of filled) {
        const inv = line.inv!;
        const sp = Number(line.sellingPrice.replace(/,/g, ''));
        const gst = Number(line.gstPercent);
        const qty = Number(line.qty);
        if (!Number.isFinite(sp) || sp < 0) {
          setErrorBanner('Enter pre-tax selling price per unit for each line.');
          return;
        }
        if (!Number.isFinite(gst) || gst < 0) {
          setErrorBanner('Check GST % on each line.');
          return;
        }
        if (!Number.isFinite(qty) || qty < 1) {
          setErrorBanner('Enter quantity on each line.');
          return;
        }
        if (inv.mrp > 0 && sp > inv.mrp) {
          setErrorBanner(`Selling cannot exceed MRP for ${inv.name}.`);
          return;
        }
      }
    }

    setSubmitting(true);
    setErrorBanner(null);
    try {
      const bookingItems = bookingLines.map((line) => ({
        catalogProductId: line.product.id,
        hearingAidPrice: Number(line.mrp),
        bookingSellingPrice: Number(line.selling),
        bookingQuantity: Math.max(1, Math.floor(Number(line.qty) || 1)),
      }));
      const t0 = trialModels[0];
      const t1 = trialModels[1];
      const details =
        receiptType === 'booking'
          ? {
              booking: {
                whichEar: bookingEar as 'left' | 'right' | 'both',
                items: bookingItems,
                catalogProductId: bookingItems[0].catalogProductId,
                hearingAidPrice: bookingItems[0].hearingAidPrice,
                bookingSellingPrice: bookingItems[0].bookingSellingPrice,
                bookingQuantity: bookingItems[0].bookingQuantity,
              },
            }
          : receiptType === 'trial'
            ? {
                trial: {
                  catalogProductId: t0!.product.id,
                  ...(t1
                    ? {
                        secondCatalogProductId: t1.product.id,
                        secondHearingAidPrice: Number(t1.mrp),
                        secondTrialSerialNumber: trialLoc === 'home' ? t1.serial.trim() : '',
                      }
                    : {}),
                  trialLocationType: trialLoc,
                  whichEar: trialEar as 'left' | 'right' | 'both',
                  hearingAidPrice: Number(t0!.mrp),
                  trialDuration: trialLoc === 'home' ? Math.max(1, Math.floor(Number(trialDuration) || 1)) : 0,
                  trialStartDate: trialLoc === 'home' ? trialStart.trim() : '',
                  trialEndDate: trialLoc === 'home' ? trialEnd.trim() : '',
                  trialSerialNumber: trialLoc === 'home' ? t0!.serial.trim() : '',
                  trialHomeSecurityDepositAmount: trialLoc === 'home' ? Number(trialDeposit) : 0,
                  trialNotes: trialNotes.trim(),
                },
              }
            : {
                sale: {
                  whichEar: saleEar as 'left' | 'right' | 'both',
                  products: saleLines
                    .filter((l) => l.inv)
                    .map((l) => {
                      const inv = l.inv!;
                      const sp = Number(l.sellingPrice.replace(/,/g, ''));
                      const gst = Number(l.gstPercent);
                      const qty = Math.max(1, Math.floor(Number(l.qty) || 1));
                      const disc = derivedDiscountPercentFromMrpSelling(inv.mrp, sp);
                      const w = l.warranty.trim();
                      return {
                        productId: inv.productId,
                        name: inv.name,
                        company: inv.company,
                        serialNumber: inv.serialNumber,
                        mrp: inv.mrp,
                        sellingPrice: sp,
                        discountPercent: disc,
                        gstPercent: gst,
                        quantity: qty,
                        ...(w ? { warranty: w } : {}),
                      };
                    }),
                },
              };

      const htmlTemplateId = htmlTemplateIdForReceiptType(templateLabels, receiptType);

      if (draftMode && fromCheckout) {
        const summaryLines: string[] = [];
        if (receiptType === 'booking') {
          for (const line of bookingLines) {
            summaryLines.push(
              `${line.product.name} · MRP ₹${line.mrp} · sell ₹${line.selling} · qty ${line.qty}`
            );
          }
        } else if (receiptType === 'trial') {
          for (const m of trialModels) {
            summaryLines.push(
              `${m.product.name} · MRP ₹${m.mrp}${m.serial ? ` · SN ${m.serial}` : ''}`
            );
          }
          summaryLines.push(`Trial type: ${trialLoc}`);
        } else {
          for (const line of saleLines.filter((l) => l.inv)) {
            const inv = line.inv!;
            summaryLines.push(`${inv.name} · SN ${inv.serialNumber} · sell ₹${line.sellingPrice}`);
          }
        }
        const draftResult = await saveCheckoutDraft({
          appointmentId: resolved.id,
          patch: {
            commerce: {
              receiptType,
              amount: n,
              paymentMode,
              details,
              summaryLines,
            },
            commerceSkipped: false,
          },
        });
        if (!draftResult.ok) {
          setErrorBanner(draftResult.error || 'Could not save for telecaller review');
          return;
        }
        alert('Saved for telecaller review. Continue checkout, then PIN will be last.');
        goBack();
        return;
      }

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
      goBack();
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
      if (fromCheckout) {
        await saveCheckoutDraft({
          appointmentId: resolved.id,
          patch: {
            services: {
              ...built.services,
              savedAt: new Date().toISOString(),
            },
            servicesSkipped: false,
          },
        });
        alert('Visit services saved. Continue checkout — telecaller will review these details.');
        goBack();
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
          <button type="button" className={styles.backBtn} onClick={goBack} aria-label="Back">
            <ArrowLeft size={22} strokeWidth={2} />
          </button>
          <h1 className={styles.title}>Visit details</h1>
        </header>
        {errorBanner ? <p className={styles.errorText}>{errorBanner}</p> : null}
      </div>
    );
  }

  const typeLabel = resolved.type === 'home' ? 'Home visit' : 'Center';
  const startIso = getStartForDisplay(resolved.start);
  const pageTitle =
    screenMode === 'payment'
      ? 'Booking / trial / sale'
      : screenMode === 'services'
        ? 'Visit services'
        : 'Visit details';
  const pageKicker =
    screenMode === 'payment'
      ? draftMode
        ? 'Fill now · telecaller confirms · sent after PIN'
        : 'Send to admin after visit complete'
      : fromCheckout
        ? 'Checkout · Services only'
        : 'Visit workspace';

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={goBack} aria-label="Back">
          <ArrowLeft size={22} strokeWidth={2} />
        </button>
        <div className={styles.headerCenter}>
          <p className={styles.headerKicker}>{pageKicker}</p>
          <h1 className={styles.title}>{pageTitle}</h1>
        </div>
      </header>

      <form id="receipt-form" className={styles.form} onSubmit={handleSubmit}>
        {errorBanner ? <p className={styles.errorText}>{errorBanner}</p> : null}

        <div className={styles.appointmentHero}>
          <p className={styles.heroKicker}>Appointment</p>
          <p className={styles.heroName}>{resolved.patientName || resolved.title || 'Patient'}</p>
          <p className={styles.heroMeta}>Enquiry · {resolved.enquiryId || '—'}</p>
          <p className={styles.heroMeta}>
            {typeLabel} · {formatTime(startIso)}
          </p>
        </div>

        {screenMode === 'services' ? (
          <p className={styles.visitHint}>
            {fromCheckout
              ? 'Log clinical services now. The telecaller will confirm these with the patient before the PIN.'
              : 'Log clinical services only. Booking / trial / sale is unlocked after home visit checkout is completed.'}
          </p>
        ) : null}
        {screenMode === 'payment' && resolved.type === 'home' && !draftMode ? (
          <p className={styles.visitHint}>
            Visit is completed. Send booking, trial, or sale to admin for verification.
          </p>
        ) : null}
        {screenMode === 'payment' && draftMode ? (
          <p className={styles.visitHint}>
            Fill booking / trial / sale now for telecaller review. Admin receives it only after PIN verification.
          </p>
        ) : null}

        {(screenMode === 'services' || screenMode === 'both') ? (
          <>
        <h2 className={styles.visitBlockTitle}>Visit services (CRM)</h2>
        <p className={styles.visitHint}>
          Same test types and staff names as the CRM enquiry form. Requires internet. Link an enquiry if missing.
        </p>
        {!resolved.enquiryId?.trim() ? (
          <p className={styles.visitMuted}>No enquiry linked — connect this appointment in CRM to save visit services.</p>
        ) : !showServicesSection ? (
          <p className={styles.visitMuted}>Visit services are not available for this appointment.</p>
        ) : (
          <div className={styles.visitServicesShell}>
            <section className={`${styles.visitSvcCard} ${hearingTest ? styles.visitSvcCardOn : ''}`}>
              <div className={styles.vsRowBetween}>
                <button
                  type="button"
                  className={styles.vsSectionHeaderTap}
                  onClick={() => toggleVs('ht')}
                  disabled={visitFormBusy}
                >
                  {vsOpen.ht ? <ChevronDown size={18} strokeWidth={2} /> : <ChevronRight size={18} strokeWidth={2} />}
                  <span className={styles.vsSectionTitle}>Hearing test</span>
                </button>
                <input
                  type="checkbox"
                  checked={hearingTest}
                  onChange={(e) => setHearingTest(e.target.checked)}
                  disabled={visitFormBusy}
                  aria-label="Hearing test"
                />
              </div>
              {hearingTest && vsOpen.ht ? (
                <>
                  {htEntries.map((row) => (
                    <div key={row.id} className={styles.vsHtBlock}>
                      <div className={styles.vsHtRow}>
                        <div className={styles.vsHtTypeCol}>
                          {row.testTypeCustom ? (
                            <input
                              className={styles.vsInput}
                              placeholder="Custom test type"
                              value={row.testType}
                              disabled={visitFormBusy}
                              onChange={(e) => {
                                const next = [...htEntries];
                                const idx = next.findIndex((r) => r.id === row.id);
                                if (idx >= 0) next[idx] = { ...row, testType: e.target.value };
                                setHtEntries(next);
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className={styles.vsPickerBtn}
                              onClick={() => setSelectModal({ kind: 'ht', rowId: row.id })}
                              disabled={visitFormBusy}
                            >
                              <span className={styles.vsPickerBtnText}>{resolveHtLabel(row)}</span>
                              <ChevronDown size={18} strokeWidth={2} />
                            </button>
                          )}
                          <button
                            type="button"
                            className={styles.vsToggleLink}
                            onClick={() => {
                              const next = [...htEntries];
                              const idx = next.findIndex((r) => r.id === row.id);
                              if (idx >= 0) {
                                next[idx] = {
                                  ...row,
                                  testTypeCustom: !row.testTypeCustom,
                                  testType: row.testTypeCustom ? '' : row.testType,
                                };
                                setHtEntries(next);
                              }
                            }}
                            disabled={visitFormBusy}
                          >
                            {row.testTypeCustom ? 'Use CRM list' : 'Custom'}
                          </button>
                        </div>
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
                          <Trash2 size={22} strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={styles.vsAddRow}
                    disabled={visitFormBusy}
                    onClick={() =>
                      setHtEntries((prev) => [
                        ...prev,
                        { id: newHtId(), testType: '', price: '', testTypeCustom: false },
                      ])
                    }
                  >
                    <CirclePlus size={18} strokeWidth={2} />
                    Add test line
                  </button>
                  <label className={styles.vsFieldLabel}>Test done by</label>
                  <button
                    type="button"
                    className={styles.vsPickerBtn}
                    onClick={() => setSelectModal({ kind: 'staff_test' })}
                    disabled={visitFormBusy}
                  >
                    <span className={styles.vsPickerBtnText}>
                      {testDoneBy.trim() || 'Select staff (CRM list)'}
                    </span>
                    <ChevronDown size={18} strokeWidth={2} />
                  </button>
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

            <section className={`${styles.visitSvcCard} ${accessory ? styles.visitSvcCardOn : ''}`}>
              <div className={styles.vsRowBetween}>
                <button
                  type="button"
                  className={styles.vsSectionHeaderTap}
                  onClick={() => toggleVs('acc')}
                  disabled={visitFormBusy}
                >
                  {vsOpen.acc ? <ChevronDown size={18} strokeWidth={2} /> : <ChevronRight size={18} strokeWidth={2} />}
                  <span className={styles.vsSectionTitle}>Accessory</span>
                </button>
                <input
                  type="checkbox"
                  checked={accessory}
                  onChange={(e) => setAccessory(e.target.checked)}
                  disabled={visitFormBusy}
                  aria-label="Accessory"
                />
              </div>
              {accessory && vsOpen.acc ? (
                <>
                  <button
                    type="button"
                    className={styles.vsCatalogLink}
                    onClick={() => {
                      setAccessoryCatalogSearch('');
                      setAccessoryCatalogModal(true);
                    }}
                    disabled={visitFormBusy}
                  >
                    <List size={18} strokeWidth={2} />
                    <span>Pick from catalog (Accessory / Battery / Charger)</span>
                  </button>
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

            <section className={`${styles.visitSvcCard} ${programming ? styles.visitSvcCardOn : ''}`}>
              <div className={styles.vsRowBetween}>
                <button
                  type="button"
                  className={styles.vsSectionHeaderTap}
                  onClick={() => toggleVs('prog')}
                  disabled={visitFormBusy}
                >
                  {vsOpen.prog ? <ChevronDown size={18} strokeWidth={2} /> : <ChevronRight size={18} strokeWidth={2} />}
                  <span className={styles.vsSectionTitle}>Programming</span>
                </button>
                <input
                  type="checkbox"
                  checked={programming}
                  onChange={(e) => setProgramming(e.target.checked)}
                  disabled={visitFormBusy}
                  aria-label="Programming"
                />
              </div>
              {programming && vsOpen.prog ? (
                <>
                  <VsField label="Reason" value={programmingReason} onChange={setProgrammingReason} multiline disabled={visitFormBusy} />
                  <VsField label="Amount (₹)" value={programmingAmount} onChange={setProgrammingAmount} inputMode="decimal" disabled={visitFormBusy} />
                  <label className={styles.vsFieldLabel}>Done by</label>
                  <button
                    type="button"
                    className={styles.vsPickerBtn}
                    onClick={() => setSelectModal({ kind: 'staff_prog' })}
                    disabled={visitFormBusy}
                  >
                    <span className={styles.vsPickerBtnText}>
                      {programmingDoneBy.trim() || 'Select staff (CRM list)'}
                    </span>
                    <ChevronDown size={18} strokeWidth={2} />
                  </button>
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

            <section className={`${styles.visitSvcCard} ${counselling ? styles.visitSvcCardOn : ''}`}>
              <div className={styles.vsRowBetween}>
                <button
                  type="button"
                  className={styles.vsSectionHeaderTap}
                  onClick={() => toggleVs('cou')}
                  disabled={visitFormBusy}
                >
                  {vsOpen.cou ? <ChevronDown size={18} strokeWidth={2} /> : <ChevronRight size={18} strokeWidth={2} />}
                  <span className={styles.vsSectionTitle}>Counselling</span>
                </button>
                <input
                  type="checkbox"
                  checked={counselling}
                  onChange={(e) => setCounselling(e.target.checked)}
                  disabled={visitFormBusy}
                  aria-label="Counselling"
                />
              </div>
              {counselling && vsOpen.cou ? (
                <VsField label="Notes" value={counsellingNotes} onChange={setCounsellingNotes} multiline disabled={visitFormBusy} />
              ) : null}
            </section>

          </div>
        )}
          </>
        ) : null}

        {showPaymentSection ? (
          <>
            <h2 className={styles.visitBlockTitle}>Send to admin</h2>
            <p className={styles.visitHint}>
              Choose one option, fill only the details for that option, then enter what was collected and send.
            </p>

            <p className={styles.commerceStep}>Step 1 · What are you sending?</p>
            <div className={styles.commerceTypeGrid}>
              {(
                [
                  {
                    id: 'booking' as const,
                    title: 'Booking',
                    desc: 'Advance / booking for a device from catalog',
                  },
                  {
                    id: 'trial' as const,
                    title: 'Trial',
                    desc: 'In-office or home trial',
                  },
                  {
                    id: 'invoice' as const,
                    title: 'Sale',
                    desc: 'Final sale with inventory serial',
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`${styles.commerceTypeCard} ${receiptType === opt.id ? styles.commerceTypeCardOn : ''}`}
                  onClick={() => setReceiptType(opt.id)}
                  disabled={visitFormBusy}
                >
                  <span className={styles.commerceTypeTitle}>{opt.title}</span>
                  <span className={styles.commerceTypeDesc}>{opt.desc}</span>
                </button>
              ))}
            </div>

            <p className={styles.commerceStep}>
              Step 2 · {receiptType === 'invoice' ? 'Sale' : receiptType === 'trial' ? 'Trial' : 'Booking'}{' '}
              details
            </p>

            {receiptType === 'booking' ? (
              <div className={styles.commercePanel}>
                <p className={styles.commercePanelLead}>
                  Select one or more catalog products, then set MRP / selling / qty for each.
                </p>
                <button
                  type="button"
                  className={styles.pickBtn}
                  onClick={() => {
                    setCatalogSearch('');
                    setPickerMode('bookingCatalog');
                  }}
                >
                  <span className={styles.addLineInner}>
                    <CirclePlus size={18} strokeWidth={2} />
                    {bookingLines.length ? 'Add / change products' : 'Select products from catalog'}
                  </span>
                </button>
                {bookingLines.map((line) => (
                  <div key={line.id} className={styles.saleLineCard}>
                    <div className={styles.saleLineHeader}>
                      <span className={styles.blockTitle}>{line.product.name}</span>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label="Remove"
                        onClick={() => setBookingLines((prev) => prev.filter((x) => x.id !== line.id))}
                      >
                        <Trash2 size={20} strokeWidth={2} />
                      </button>
                    </div>
                    <p className={styles.meta}>
                      {line.product.company} · {line.product.type}
                    </p>
                    <div className={styles.twoColFields}>
                      <div>
                        <label className={styles.label}>MRP ₹</label>
                        <input
                          className={styles.input}
                          inputMode="decimal"
                          value={line.mrp}
                          onChange={(e) =>
                            setBookingLines((prev) =>
                              prev.map((l) => (l.id === line.id ? { ...l, mrp: e.target.value } : l))
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className={styles.label}>Selling ₹</label>
                        <input
                          className={styles.input}
                          inputMode="decimal"
                          value={line.selling}
                          onChange={(e) =>
                            setBookingLines((prev) =>
                              prev.map((l) => (l.id === line.id ? { ...l, selling: e.target.value } : l))
                            )
                          }
                        />
                      </div>
                    </div>
                    <label className={styles.label}>Quantity</label>
                    <input
                      className={styles.input}
                      inputMode="numeric"
                      value={line.qty}
                      onChange={(e) =>
                        setBookingLines((prev) =>
                          prev.map((l) => (l.id === line.id ? { ...l, qty: e.target.value } : l))
                        )
                      }
                    />
                  </div>
                ))}
                <p className={styles.label}>Which ear?</p>
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
                {suggestedBookingTotal > 0 ? (
                  <p className={styles.suggestedTotal}>Suggested from lines: ₹{suggestedBookingTotal}</p>
                ) : null}
              </div>
            ) : null}

            {receiptType === 'trial' ? (
              <div className={styles.commercePanel}>
                <p className={styles.commercePanelLead}>
                  Select up to 2 trial models. For home trial, pick a stock serial for each model.
                </p>
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
                <p className={styles.label}>Which ear?</p>
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
                <button
                  type="button"
                  className={styles.pickBtn}
                  onClick={() => {
                    setCatalogSearch('');
                    setPickerMode('trialCatalog');
                  }}
                >
                  <span className={styles.addLineInner}>
                    <CirclePlus size={18} strokeWidth={2} />
                    {trialModels.length ? 'Change trial models' : 'Select trial models (max 2)'}
                  </span>
                </button>
                {trialModels.map((m, idx) => (
                  <div key={m.id} className={styles.saleLineCard}>
                    <div className={styles.saleLineHeader}>
                      <span className={styles.blockTitle}>
                        Model {idx + 1} · {m.product.name}
                      </span>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label="Remove"
                        onClick={() => setTrialModels((prev) => prev.filter((x) => x.id !== m.id))}
                      >
                        <Trash2 size={20} strokeWidth={2} />
                      </button>
                    </div>
                    <p className={styles.meta}>
                      {m.product.company} · {m.product.type}
                    </p>
                    <label className={styles.label}>MRP ₹</label>
                    <input
                      className={styles.input}
                      inputMode="decimal"
                      value={m.mrp}
                      onChange={(e) =>
                        setTrialModels((prev) =>
                          prev.map((x) => (x.id === m.id ? { ...x, mrp: e.target.value } : x))
                        )
                      }
                    />
                    {trialLoc === 'home' ? (
                      <>
                        <button
                          type="button"
                          className={`${styles.pickBtn} ${m.serial ? styles.invRowActive : ''}`}
                          onClick={() => {
                            setInvSearch('');
                            setTrialSerialPickId(m.id);
                            setPickerMode('trialStock');
                            void loadInventory();
                          }}
                        >
                          {m.serial ? `Serial: ${m.serial}` : 'Pick stock serial'}
                        </button>
                      </>
                    ) : null}
                  </div>
                ))}
                {trialLoc === 'home' ? (
                  <div className={styles.homeTrialBox}>
                    <p className={styles.commercePanelLead}>Home trial period</p>
                    <label className={styles.label}>Days</label>
                    <input
                      className={styles.input}
                      inputMode="numeric"
                      value={trialDuration}
                      onChange={(e) => setTrialDuration(e.target.value)}
                    />
                    <div className={styles.twoColFields}>
                      <div>
                        <label className={styles.label}>Start</label>
                        <input
                          className={styles.input}
                          type="date"
                          value={trialStart}
                          onChange={(e) => setTrialStart(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className={styles.label}>End</label>
                        <input
                          className={styles.input}
                          type="date"
                          value={trialEnd}
                          onChange={(e) => setTrialEnd(e.target.value)}
                        />
                      </div>
                    </div>
                    <label className={styles.label}>Security deposit ₹</label>
                    <input
                      className={styles.input}
                      inputMode="decimal"
                      value={trialDeposit}
                      onChange={(e) => setTrialDeposit(e.target.value)}
                    />
                  </div>
                ) : (
                  <p className={styles.infoNote}>In-office trial — no stock serial needed.</p>
                )}
                <label className={styles.label}>Notes (optional)</label>
                <textarea
                  className={styles.textarea}
                  value={trialNotes}
                  onChange={(e) => setTrialNotes(e.target.value)}
                  rows={2}
                  placeholder="Anything admin should know…"
                />
              </div>
            ) : null}

            {receiptType === 'invoice' ? (
              <div className={styles.commercePanel}>
                <p className={styles.commercePanelLead}>
                  Pick one or more serials from available stock, then set selling price on each.
                </p>
                <p className={styles.label}>Which ear?</p>
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
                <button
                  type="button"
                  className={styles.pickBtn}
                  onClick={() => {
                    setInvSearch('');
                    setPickerMode('saleStock');
                    void loadInventory();
                  }}
                >
                  <span className={styles.addLineInner}>
                    <CirclePlus size={18} strokeWidth={2} />
                    {saleLines.some((l) => l.inv) ? 'Add more stock items' : 'Select stock (multi-select)'}
                  </span>
                </button>
                {saleLines.filter((l) => l.inv).map((line, idx) => {
                  const inv = line.inv!;
                  const sp = parseFloat(line.sellingPrice.replace(/,/g, '')) || 0;
                  const gst = parseFloat(line.gstPercent) || 0;
                  const qty = Math.max(1, Math.floor(parseFloat(line.qty) || 1));
                  const discPct = inv.mrp > 0 ? derivedDiscountPercentFromMrpSelling(inv.mrp, sp) : 0;
                  const lineTot = lineInclusiveTotal(inv.mrp, sp, gst, qty);
                  return (
                    <div key={line.id} className={styles.saleLineCard}>
                      <div className={styles.saleLineHeader}>
                        <span className={styles.blockTitle}>
                          Item {idx + 1} · {inv.name}
                        </span>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          aria-label="Remove"
                          onClick={() => setSaleLines((prev) => prev.filter((x) => x.id !== line.id))}
                        >
                          <Trash2 size={20} strokeWidth={2} />
                        </button>
                      </div>
                      <p className={styles.meta}>
                        {inv.company} · SN {inv.serialNumber} · MRP ₹{inv.mrp}
                      </p>
                      <p className={styles.meta}>Discount from MRP: {discPct}%</p>
                      <div className={styles.twoColFields}>
                        <div>
                          <label className={styles.label}>Selling ₹ (pre-tax)</label>
                          <input
                            className={styles.input}
                            inputMode="decimal"
                            value={line.sellingPrice}
                            onChange={(e) =>
                              setSaleLines((prev) =>
                                prev.map((l) =>
                                  l.id === line.id ? { ...l, sellingPrice: e.target.value } : l
                                )
                              )
                            }
                          />
                        </div>
                        <div>
                          <label className={styles.label}>Qty</label>
                          <input
                            className={styles.input}
                            inputMode="numeric"
                            value={line.qty}
                            onChange={(e) =>
                              setSaleLines((prev) =>
                                prev.map((l) => (l.id === line.id ? { ...l, qty: e.target.value } : l))
                              )
                            }
                          />
                        </div>
                      </div>
                      <p className={styles.meta}>
                        GST {gst}% · Line total ₹{lineTot}
                      </p>
                      <p className={styles.label}>Warranty</p>
                      <div className={styles.chips}>
                        {HEARING_AID_SALE_WARRANTY_OPTIONS.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            className={`${styles.chip} ${line.warranty === opt ? styles.chipActive : ''}`}
                            onClick={() =>
                              setSaleLines((prev) =>
                                prev.map((l) => (l.id === line.id ? { ...l, warranty: opt } : l))
                              )
                            }
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                      <label className={styles.label}>Or type warranty</label>
                      <input
                        className={styles.input}
                        value={line.warranty}
                        onChange={(e) =>
                          setSaleLines((prev) =>
                            prev.map((l) => (l.id === line.id ? { ...l, warranty: e.target.value } : l))
                          )
                        }
                      />
                    </div>
                  );
                })}
                {suggestedInvoiceTotal > 0 ? (
                  <p className={styles.suggestedTotal}>Suggested payment: ₹{suggestedInvoiceTotal}</p>
                ) : null}
              </div>
            ) : null}

            <p className={styles.commerceStep}>Step 3 · Payment collected today</p>
            <div className={styles.commercePanel}>
              <div className={styles.amountHero}>
                <label className={styles.amountLabel} htmlFor="amount">
                  Amount collected ₹
                </label>
                <div className={styles.amountRow}>
                  <span className={styles.amountRupee} aria-hidden>
                    ₹
                  </span>
                  <input
                    id="amount"
                    className={styles.amountInput}
                    inputMode="decimal"
                    placeholder="0"
                    value={amount}
                    onChange={(ev) => setAmount(ev.target.value)}
                    disabled={visitFormBusy}
                    autoComplete="off"
                  />
                </div>
              </div>

              <p className={styles.pillGroupLabel}>Paid by</p>
              <div className={styles.pillRow}>
                {(['cash', 'upi', 'card'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`${styles.pill} ${paymentMode === m ? styles.pillActive : ''}`}
                    onClick={() => setPaymentMode(m)}
                    disabled={visitFormBusy}
                  >
                    {m.toUpperCase()}
                  </button>
                ))}
              </div>

              {currentPdfTemplate ? (
                <p className={styles.meta}>Admin PDF: {currentPdfTemplate.name}</p>
              ) : (
                <p className={styles.meta}>Admin PDF: default template</p>
              )}
            </div>
          </>
        ) : null}

        <div className={styles.actionDock}>
          {showServicesSection ? (
            <button
              type="button"
              className={styles.btnPrimarySolid}
              disabled={visitFormBusy}
              onClick={() => void handleSaveVisitServices()}
            >
              {savingVisitServices ? 'Saving…' : 'Save visit services'}
            </button>
          ) : null}
          {showPaymentSection ? (
            <button type="submit" className={styles.btnTealSolid} disabled={visitFormBusy}>
              {submitting
                ? 'Saving…'
                : draftMode
                  ? receiptType === 'invoice'
                    ? 'Save sale for telecaller review'
                    : receiptType === 'trial'
                      ? 'Save trial for telecaller review'
                      : 'Save booking for telecaller review'
                  : receiptType === 'invoice'
                    ? 'Send sale to admin'
                    : receiptType === 'trial'
                      ? 'Send trial to admin'
                      : 'Send booking to admin'}
            </button>
          ) : null}
          {fromCheckout ? (
            <button type="button" className={styles.btnTealSolid} onClick={goBack}>
              Back to checkout
            </button>
          ) : null}
        </div>
      </form>

      {pickerMode === 'bookingCatalog' ? (
        <ProductPickSheet
          kind="catalog"
          title="Select booking products"
          subtitle="Tap to select multiple items, then Add"
          items={catalogItems}
          knownItems={bookingLines.map((l) => l.product)}
          loading={catalogLoading}
          selectedIds={bookingLines.map((l) => l.product.id)}
          search={catalogSearch}
          onSearch={setCatalogSearch}
          onClose={() => setPickerMode(null)}
          onConfirm={(selected) => {
            setBookingLines((prev) => {
              const keep = new Map(prev.map((l) => [l.product.id, l]));
              return selected.map((p) => {
                const existing = keep.get(p.id);
                if (existing) return existing;
                const m = String(p.mrp ?? 0);
                return {
                  id: newBookingLineId(),
                  product: p,
                  mrp: m,
                  selling: m,
                  qty: '1',
                };
              });
            });
            setPickerMode(null);
          }}
        />
      ) : null}

      {pickerMode === 'trialCatalog' ? (
        <ProductPickSheet
          kind="catalog"
          title="Select trial models"
          subtitle="Choose up to 2 models"
          items={catalogItems}
          knownItems={trialModels.map((m) => m.product)}
          loading={catalogLoading}
          selectedIds={trialModels.map((m) => m.product.id)}
          maxSelect={2}
          search={catalogSearch}
          onSearch={setCatalogSearch}
          onClose={() => setPickerMode(null)}
          onConfirm={(selected) => {
            setTrialModels((prev) => {
              const keep = new Map(prev.map((m) => [m.product.id, m]));
              return selected.slice(0, 2).map((p) => {
                const existing = keep.get(p.id);
                if (existing) return existing;
                return {
                  id: newTrialModelId(),
                  product: p,
                  mrp: String(p.mrp ?? 0),
                  serial: '',
                };
              });
            });
            setPickerMode(null);
          }}
        />
      ) : null}

      {pickerMode === 'saleStock' ? (
        <ProductPickSheet
          kind="stock"
          title="Available stock"
          subtitle="Tap serials to multi-select, then Add"
          items={inventoryItems}
          loading={inventoryLoading}
          selectedLineIds={[]}
          disabledLineIds={saleLines.filter((l) => l.inv).map((l) => l.inv!.lineId)}
          search={invSearch}
          onSearch={setInvSearch}
          onClose={() => setPickerMode(null)}
          onConfirm={(selected) => {
            setSaleLines((prev) => {
              const existingSerials = new Set(
                prev.filter((l) => l.inv).map((l) => l.inv!.serialNumber)
              );
              const next = prev.filter((l) => l.inv);
              for (const it of selected) {
                if (existingSerials.has(it.serialNumber)) continue;
                existingSerials.add(it.serialNumber);
                next.push({
                  id: newSaleLineId(),
                  inv: it,
                  sellingPrice: String(it.mrp ?? 0),
                  gstPercent: String(effectiveGstPercentFromInventoryRow(it)),
                  qty: '1',
                  warranty: '',
                });
              }
              return next.length ? next : prev;
            });
            setPickerMode(null);
          }}
        />
      ) : null}

      {pickerMode === 'trialStock' && trialSerialPickId ? (
        <ProductPickSheet
          kind="stock"
          title="Pick serial for trial model"
          subtitle={
            trialModels.find((m) => m.id === trialSerialPickId)?.product.name || 'Select one serial'
          }
          items={inventoryItems}
          loading={inventoryLoading}
          selectedLineIds={(() => {
            const m = trialModels.find((x) => x.id === trialSerialPickId);
            if (!m?.serial) return [];
            const row = inventoryItems.find(
              (it) => it.productId === m.product.id && it.serialNumber === m.serial
            );
            return row ? [row.lineId] : [];
          })()}
          filterProductIds={[
            trialModels.find((m) => m.id === trialSerialPickId)?.product.id || '',
          ].filter(Boolean)}
          maxSelect={1}
          search={invSearch}
          onSearch={setInvSearch}
          onClose={() => {
            setPickerMode(null);
            setTrialSerialPickId(null);
          }}
          onConfirm={(selected) => {
            const row = selected[0];
            if (row) {
              setTrialModels((prev) =>
                prev.map((m) =>
                  m.id === trialSerialPickId ? { ...m, serial: row.serialNumber } : m
                )
              );
            }
            setPickerMode(null);
            setTrialSerialPickId(null);
          }}
        />
      ) : null}

      {selectModal ? (
        <div
          className={styles.vsModalBackdrop}
          role="presentation"
          onClick={() => setSelectModal(null)}
          onKeyDown={(e) => e.key === 'Escape' && setSelectModal(null)}
        >
          <div
            className={styles.vsModalPanel}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.vsModalHeader}>
              <button type="button" className={styles.vsModalClose} onClick={() => setSelectModal(null)}>
                Close
              </button>
              <h2 className={styles.vsModalTitle}>
                {selectModal.kind === 'ht'
                  ? 'Test type'
                  : selectModal.kind === 'staff_test'
                    ? 'Test done by'
                    : 'Programming done by'}
              </h2>
            </div>
            <input
              className={styles.input}
              placeholder={selectModal.kind === 'ht' ? 'Search test types' : 'Search staff'}
              value={optionSearch}
              onChange={(e) => setOptionSearch(e.target.value)}
            />
            {selectModal.kind === 'ht' ? (
              <div className={styles.vsModalList}>
                {filteredHtOptions.map((item) => (
                  <button
                    key={item.optionValue}
                    type="button"
                    className={styles.vsModalRow}
                    onClick={() => {
                      const rowId = selectModal.kind === 'ht' ? selectModal.rowId : '';
                      const idx = htEntries.findIndex((x) => x.id === rowId);
                      if (idx >= 0) {
                        const next = [...htEntries];
                        next[idx] = { ...next[idx], testType: item.optionValue, testTypeCustom: false };
                        setHtEntries(next);
                      }
                      setSelectModal(null);
                    }}
                  >
                    <span className={styles.invName}>{item.optionLabel}</span>
                    <span className={styles.invSub}>{item.optionValue}</span>
                  </button>
                ))}
                {filteredHtOptions.length === 0 ? (
                  <p className={styles.visitMuted}>No matching types. Try custom.</p>
                ) : null}
                <button
                  type="button"
                  className={styles.vsModalRow}
                  onClick={() => {
                    const rowId = selectModal.kind === 'ht' ? selectModal.rowId : '';
                    const idx = htEntries.findIndex((x) => x.id === rowId);
                    if (idx >= 0) {
                      const next = [...htEntries];
                      next[idx] = { ...next[idx], testType: '', testTypeCustom: true };
                      setHtEntries(next);
                    }
                    setSelectModal(null);
                  }}
                >
                  <span className={styles.invName}>Other / custom…</span>
                  <span className={styles.invSub}>Enter text in the form</span>
                </button>
              </div>
            ) : (
              <>
                <div className={styles.vsModalList}>
                  {filteredStaffModal.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={styles.vsModalRow}
                      onClick={() => {
                        if (selectModal.kind === 'staff_test') setTestDoneBy(item);
                        if (selectModal.kind === 'staff_prog') setProgrammingDoneBy(item);
                        setSelectModal(null);
                      }}
                    >
                      <span className={styles.invName}>{item}</span>
                    </button>
                  ))}
                  {filteredStaffModal.length === 0 ? <p className={styles.visitMuted}>No matches.</p> : null}
                </div>
                <label className={styles.vsFieldLabel}>Name not listed</label>
                <input
                  className={styles.input}
                  placeholder="Type full name"
                  value={staffCustomDraft}
                  onChange={(e) => setStaffCustomDraft(e.target.value)}
                />
                <button
                  type="button"
                  className={styles.vsModalPrimary}
                  onClick={() => {
                    const t = staffCustomDraft.trim();
                    if (!t) return;
                    if (selectModal.kind === 'staff_test') setTestDoneBy(t);
                    if (selectModal.kind === 'staff_prog') setProgrammingDoneBy(t);
                    setSelectModal(null);
                  }}
                >
                  Use this name
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {accessoryCatalogModal ? (
        <div
          className={styles.vsModalBackdrop}
          role="presentation"
          onClick={() => setAccessoryCatalogModal(false)}
        >
          <div
            className={styles.vsModalPanel}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.vsModalHeader}>
              <button type="button" className={styles.vsModalClose} onClick={() => setAccessoryCatalogModal(false)}>
                Close
              </button>
              <h2 className={styles.vsModalTitle}>Accessory catalog</h2>
            </div>
            <input
              className={styles.input}
              placeholder="Search accessory, battery, charger"
              value={accessoryCatalogSearch}
              onChange={(e) => setAccessoryCatalogSearch(e.target.value)}
            />
            {accessoryCatalogLoading ? (
              <p className={styles.meta}>Loading…</p>
            ) : (
              <div className={styles.vsModalList}>
                {accessoryCatalogItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={styles.vsModalRow}
                    onClick={() => {
                      setAccessoryName(item.name);
                      setAccessoryCatalogModal(false);
                    }}
                  >
                    <span className={styles.invName}>{item.name}</span>
                    <span className={styles.invSub}>
                      {item.company} · {item.type} · ₹{item.mrp ?? 0}
                    </span>
                  </button>
                ))}
                {accessoryCatalogItems.length === 0 ? (
                  <p className={styles.visitMuted}>No products. Try search.</p>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
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
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
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
