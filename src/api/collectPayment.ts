import { auth } from '../firebase';
import { crmFetch } from './crmBase';

export type ReceiptType = 'trial' | 'booking' | 'invoice';
export type PaymentMode = 'cash' | 'upi' | 'card';

export type CollectPaymentBookingLine = {
  catalogProductId: string;
  hearingAidPrice: number;
  bookingSellingPrice: number;
  bookingQuantity: number;
};

export type CollectPaymentBookingDetails = {
  whichEar: 'left' | 'right' | 'both';
  /** Preferred multi-item payload. */
  items: CollectPaymentBookingLine[];
  /** Legacy mirrors of first item (server still accepts). */
  catalogProductId: string;
  hearingAidPrice: number;
  bookingSellingPrice: number;
  bookingQuantity: number;
};

export type CollectPaymentTrialDetails = {
  catalogProductId: string;
  secondCatalogProductId?: string;
  secondHearingAidPrice?: number;
  secondTrialSerialNumber?: string;
  trialLocationType: 'in_office' | 'home';
  whichEar: 'left' | 'right' | 'both';
  hearingAidPrice: number;
  trialDuration: number;
  trialStartDate: string;
  trialEndDate: string;
  trialSerialNumber: string;
  trialHomeSecurityDepositAmount: number;
  trialNotes: string;
};

export type CollectPaymentSaleLine = {
  productId: string;
  name: string;
  company?: string;
  serialNumber: string;
  mrp: number;
  sellingPrice: number;
  discountPercent: number;
  gstPercent: number;
  quantity: number;
  warranty?: string;
};

export type CollectPaymentSaleDetails = {
  whichEar: 'left' | 'right' | 'both';
  products: CollectPaymentSaleLine[];
};

export type CollectPaymentDetails = {
  booking?: CollectPaymentBookingDetails;
  trial?: CollectPaymentTrialDetails;
  sale?: CollectPaymentSaleDetails;
};

export async function submitCollectPayment(body: {
  appointmentId: string;
  amount: number;
  paymentMode: PaymentMode;
  receiptType: ReceiptType;
  details: CollectPaymentDetails;
  /** Firestore `invoiceTemplates` id — same as CRM Invoice Manager pin for this receipt type. */
  htmlTemplateId?: string;
}): Promise<{ ok: boolean; error?: string; emailSent?: boolean; htmlTemplateIdUsed?: string | null }> {
  const user = auth.currentUser;
  if (!user) {
    return { ok: false, error: 'Not signed in' };
  }
  const idToken = await user.getIdToken();
  try {
    const res = await crmFetch('/api/appointments/collect-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
      timeoutMs: 60_000,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: (data as { error?: string }).error || 'Request failed' };
    }
    return {
      ok: true,
      emailSent: (data as { emailSent?: boolean }).emailSent,
      htmlTemplateIdUsed: (data as { htmlTemplateIdUsed?: string | null }).htmlTemplateIdUsed,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Request failed' };
  }
}
