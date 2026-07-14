/**
 * CRM API base for browser calls.
 *
 * - Local + Vercel: use same-origin `/api/...` (Vite proxy in dev, serverless proxy in prod).
 * - Never fall back to localhost in production — that hangs forever on "Notifying…".
 * - Optional absolute `VITE_CRM_URL` still works if you intentionally call CRM cross-origin.
 */
export function getCrmUrl(): string {
  const raw = String(import.meta.env.VITE_CRM_URL || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  // Production builds must not call the developer's machine
  if (!import.meta.env.DEV && /localhost|127\.0\.0\.1/i.test(raw)) return '';
  // Prefer same-origin proxies (more reliable on mobile / Safari)
  if (!import.meta.env.DEV) return '';
  return raw;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export async function crmFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const url = `${getCrmUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(
        'Request timed out reaching CRM. Check Vercel CRM_BACKEND_URL / redeploy, or try again.'
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
