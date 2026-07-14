import type { Appointment } from '../types';
import { isAppointmentToday } from '../dateUtils';

function statusOf(a: Appointment): string {
  return String(a.status || 'scheduled').toLowerCase();
}

/** Home visit fully closed via end-of-visit compliance. */
export function isHomeVisitComplianceComplete(a: Appointment): boolean {
  if (String(a.type || '').toLowerCase() !== 'home') return false;
  return (
    a.telecaller_verified === true &&
    String(a.complianceStatus || '').toLowerCase() === 'completed' &&
    a.gps_location != null &&
    a.compliance_form_data != null
  );
}

/**
 * Clinical visit services (hearing test, accessory, etc.) — during the visit,
 * before home checkout is finished.
 */
export function isEligibleForVisitServicesLogging(a: Appointment): boolean {
  if (!Boolean((a.enquiryId || '').trim())) return false;
  if (!isAppointmentToday(a.start)) return false;
  const s = statusOf(a);
  if (s === 'cancelled') return false;
  if (s === 'completed') return false;
  return !s || s === 'scheduled';
}

/**
 * Stage booking / trial / sale during home checkout (before telecaller PIN).
 */
export function isEligibleForCheckoutCommerceStaging(a: Appointment): boolean {
  if (String(a.type || '').toLowerCase() !== 'home') return false;
  if (!Boolean((a.enquiryId || '').trim())) return false;
  if (!isAppointmentToday(a.start)) return false;
  const s = statusOf(a);
  if (s === 'cancelled' || s === 'completed') return false;
  if (isHomeVisitComplianceComplete(a)) return false;
  const cs = String(a.complianceStatus || '').toLowerCase();
  if (cs === 'awaiting_telecaller_pin' || cs === 'pending_verification') return false;
  return !s || s === 'scheduled';
}

/**
 * Booking / trial / sale request to admin.
 * Home visits: only after compliance checkout is completed.
 * Center visits: during today’s scheduled visit (unchanged).
 */
export function isEligibleForPaymentToAdmin(a: Appointment): boolean {
  if (!isAppointmentToday(a.start)) return false;
  const s = statusOf(a);
  if (s === 'cancelled') return false;

  if (String(a.type || '').toLowerCase() === 'home') {
    return isHomeVisitComplianceComplete(a);
  }

  if (s === 'completed') return false;
  return !s || s === 'scheduled';
}

/** Can open the receipt workspace for either services or payment. */
export function canOpenVisitWorkspace(a: Appointment): boolean {
  return (
    isEligibleForVisitServicesLogging(a) ||
    isEligibleForPaymentToAdmin(a) ||
    isEligibleForCheckoutCommerceStaging(a)
  );
}

/**
 * @deprecated Prefer isEligibleForPaymentToAdmin / isEligibleForVisitServicesLogging.
 * Kept for list buttons that mean “today’s actionable visit”.
 */
export function isPayableAppointmentForPayment(a: Appointment): boolean {
  return canOpenVisitWorkspace(a);
}
