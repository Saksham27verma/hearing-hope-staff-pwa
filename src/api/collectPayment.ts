import { auth } from '../firebase';

function getCrmUrl(): string {
  return import.meta.env.VITE_CRM_URL || import.meta.env.CRM_BACKEND_URL || 'http://localhost:3000';
}

export type ReceiptType = 'trial' | 'booking' | 'invoice';
export type PaymentMode = 'cash' | 'upi' | 'card';

export type CollectPaymentBookingDetails = {
  catalogProductId: string;
  whichEar: 'left' | 'right' | 'both';
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
  const res = await fetch(`${getCrmUrl().replace(/\/$/, '')}/api/appointments/collect-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: (data as { error?: string }).error || 'Request failed' };
  }
  return {
    ok: true,
    emailSent: (data as { emailSent?: boolean }).emailSent,
    htmlTemplateIdUsed: (data as { htmlTemplateIdUsed?: string | null }).htmlTemplateIdUsed ?? null,
  };
}
