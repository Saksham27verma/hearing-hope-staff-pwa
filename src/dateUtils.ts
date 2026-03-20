export function parseStartToDate(start: unknown): Date | null {
  if (!start) return null;
  if (typeof start === 'string') {
    const d = new Date(start);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof start === 'object' && start !== null) {
    const o = start as { toDate?: () => Date; seconds?: number };
    if (typeof o.toDate === 'function') return o.toDate();
    if (typeof o.seconds === 'number') return new Date(o.seconds * 1000);
  }
  return null;
}

export function getStartForDisplay(start: unknown): string {
  const d = parseStartToDate(start);
  return d ? d.toISOString() : '';
}

export function isAppointmentToday(start: unknown): boolean {
  const d = parseStartToDate(start);
  if (!d) return false;
  const today = new Date();
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

export function formatDate(isoOrStart: unknown) {
  const d = typeof isoOrStart === 'string' ? new Date(isoOrStart) : parseStartToDate(isoOrStart);
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateLong(isoOrStart: unknown) {
  const d = typeof isoOrStart === 'string' ? new Date(isoOrStart) : parseStartToDate(isoOrStart);
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatTime(isoOrStart: unknown) {
  const d = typeof isoOrStart === 'string' ? new Date(isoOrStart) : parseStartToDate(isoOrStart);
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
