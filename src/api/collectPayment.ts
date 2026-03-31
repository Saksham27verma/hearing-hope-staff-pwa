import { auth } from '../firebase';

function getCrmUrl(): string {
  return (
    import.meta.env.VITE_CRM_URL ||
    import.meta.env.CRM_BACKEND_URL ||
    'http://localhost:3000'
  );
}

export type ReceiptType = 'trial' | 'booking' | 'invoice';
export type PaymentMode = 'cash' | 'upi' | 'card';

export async function submitCollectPayment(body: {
  appointmentId: string;
  amount: number;
  paymentMode: PaymentMode;
  receiptType: ReceiptType;
}): Promise<{ ok: boolean; error?: string; emailSent?: boolean }> {
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
  };
}
