import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

/** Matches CRM `crmSettings/documentTemplateRouting`. */
const ROUTING_PATH = ['crmSettings', 'documentTemplateRouting'] as const;

export type StaffReceiptTemplateLabels = {
  booking?: { id: string; name: string };
  trial?: { id: string; name: string };
  invoice?: { id: string; name: string };
};

async function loadTemplateLabel(id: string): Promise<{ id: string; name: string } | undefined> {
  const tid = id.trim();
  if (!tid) return undefined;
  const snap = await getDoc(doc(db, 'invoiceTemplates', tid));
  if (!snap.exists()) return { id: tid, name: tid };
  const d = snap.data() as { name?: string };
  const name = (d.name && String(d.name).trim()) || snap.id;
  return { id: snap.id, name };
}

/**
 * Reads Invoice Manager pins from Firestore so the staff app shows the same template
 * the server will use (and can POST `htmlTemplateId` to lock the choice).
 */
export async function loadStaffReceiptTemplateLabels(): Promise<StaffReceiptTemplateLabels> {
  const routingSnap = await getDoc(doc(db, ...ROUTING_PATH));
  const r = routingSnap.data() as
    | {
        bookingReceiptTemplateId?: string | null;
        trialReceiptTemplateId?: string | null;
        invoiceHtmlTemplateId?: string | null;
      }
    | undefined;

  const out: StaffReceiptTemplateLabels = {};
  if (r?.bookingReceiptTemplateId) {
    const x = await loadTemplateLabel(String(r.bookingReceiptTemplateId));
    if (x) out.booking = x;
  }
  if (r?.trialReceiptTemplateId) {
    const x = await loadTemplateLabel(String(r.trialReceiptTemplateId));
    if (x) out.trial = x;
  }
  if (r?.invoiceHtmlTemplateId) {
    const x = await loadTemplateLabel(String(r.invoiceHtmlTemplateId));
    if (x) out.invoice = x;
  }
  return out;
}

export function htmlTemplateIdForReceiptType(
  labels: StaffReceiptTemplateLabels,
  receiptType: 'trial' | 'booking' | 'invoice'
): string | undefined {
  if (receiptType === 'booking') return labels.booking?.id;
  if (receiptType === 'trial') return labels.trial?.id;
  return labels.invoice?.id;
}
