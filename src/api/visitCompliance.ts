import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { ComplianceFormData, GpsLocation } from '../types';
import type { CollectPaymentDetails, PaymentMode, ReceiptType } from './collectPayment';
import { crmFetch } from './crmBase';

async function staffPost<T>(
  path: string,
  body: Record<string, unknown>
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const user = auth.currentUser;
  if (!user) return { ok: false, error: 'Not signed in' };
  const idToken = await user.getIdToken();
  try {
    const res = await crmFetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
      timeoutMs: 25_000,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; ok?: boolean };
    if (!res.ok || (data as { ok?: boolean }).ok === false) {
      return { ok: false, error: (data as { error?: string }).error || 'Request failed' };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Request failed' };
  }
}

export type CheckoutDraftCommercePayload = {
  receiptType: ReceiptType;
  amount: number;
  paymentMode: PaymentMode;
  details: CollectPaymentDetails;
  summaryLines?: string[];
};

export type CheckoutDraftPatch = {
  services?: Record<string, unknown> | null;
  servicesSkipped?: boolean;
  commerce?: CheckoutDraftCommercePayload | null;
  commerceSkipped?: boolean;
  gps_location?: GpsLocation | null;
  compliance_form_data?: ComplianceFormData | null;
  feedback?: string;
};

export async function saveCheckoutDraft(body: {
  appointmentId: string;
  patch: CheckoutDraftPatch;
  readyForPin?: boolean;
}): Promise<{ ok: boolean; error?: string; complianceStatus?: string }> {
  const result = await staffPost<{ complianceStatus?: string }>('/api/appointments/save-checkout-draft', {
    appointmentId: body.appointmentId,
    patch: body.patch as Record<string, unknown>,
    readyForPin: Boolean(body.readyForPin),
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, complianceStatus: result.data.complianceStatus };
}

/**
 * Mark appointment as awaiting telecaller PIN (legacy / fallback).
 * Prefer saveCheckoutDraft({ readyForPin: true }) after all details are filled.
 */
export async function requestCompliancePin(body: {
  appointmentId: string;
}): Promise<{ ok: boolean; error?: string; complianceStatus?: string; alreadyRequested?: boolean }> {
  const user = auth.currentUser;
  if (!user) return { ok: false, error: 'Not signed in' };
  const appointmentId = String(body.appointmentId || '').trim();
  if (!appointmentId) return { ok: false, error: 'appointmentId is required' };

  try {
    await updateDoc(doc(db, 'appointments', appointmentId), {
      complianceStatus: 'awaiting_telecaller_pin',
      checkoutReadyForPin: true,
      staffAwaitingPinAt: serverTimestamp(),
      staffAwaitingPinBy: user.uid,
      complianceIncompleteSince: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to mark visit as awaiting PIN',
    };
  }

  void staffPost('/api/appointments/request-compliance-pin', { appointmentId }).catch(() => {});

  return {
    ok: true,
    alreadyRequested: false,
    complianceStatus: 'awaiting_telecaller_pin',
  };
}

export async function verifyCompliancePin(body: {
  appointmentId: string;
  pin: string;
}): Promise<{ ok: boolean; error?: string; alreadyVerified?: boolean }> {
  const result = await staffPost<{ alreadyVerified?: boolean }>('/api/appointments/verify-compliance-pin', body);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, alreadyVerified: result.data.alreadyVerified };
}

export async function completeVisitCompliance(body: {
  appointmentId: string;
  feedback?: string;
  gps_location: GpsLocation;
  compliance_form_data: ComplianceFormData;
}): Promise<{ ok: boolean; error?: string }> {
  const result = await staffPost('/api/appointments/complete-visit-compliance', body);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}
