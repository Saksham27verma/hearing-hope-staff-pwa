import type { Appointment } from '../types';
import { isAppointmentToday } from '../dateUtils';

/** Today + scheduled (or unset) + not completed/cancelled — eligible for staff payment logging. */
export function isPayableAppointmentForPayment(a: Appointment): boolean {
  if (!isAppointmentToday(a.start)) return false;
  const s = (a.status || '').toLowerCase();
  if (s === 'completed' || s === 'cancelled') return false;
  if (s && s !== 'scheduled') return false;
  return true;
}
