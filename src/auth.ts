import { signInWithCustomToken } from 'firebase/auth';
import { auth } from './firebase';

/** Production / preview: full CRM origin. Dev: same-origin path proxied by Vite (see vite.config.ts). */
export function getMobileLoginUrl(): string {
  if (import.meta.env.DEV) {
    return '/api/mobile-login';
  }
  const base = (import.meta.env.VITE_CRM_URL || '').trim().replace(/\/$/, '');
  if (!base) {
    throw new Error(
      'VITE_CRM_URL is not set. Add it to .env before building, and set the same variable in your host (e.g. Vercel).'
    );
  }
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && base.startsWith('http:')) {
    throw new Error(
      'This page is HTTPS but VITE_CRM_URL is HTTP. Use an https:// CRM URL or you will get “Failed to fetch” (mixed content).'
    );
  }
  return `${base}/api/mobile-login`;
}

function explainFetchFailure(url: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('Load failed')) {
    const isHttpsSite = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const lines = [
      'Could not reach the CRM login API (network or browser blocked the request).',
      `Trying: ${url}`,
      isHttpsSite
        ? 'If this URL starts with http:// while the app is on https://, the browser will block it (mixed content). Use https:// for VITE_CRM_URL.'
        : null,
      import.meta.env.DEV
        ? 'Local dev: ensure the CRM is running (e.g. hearing-hope-crm on port 3000) or set VITE_CRM_URL in .env to your deployed CRM, then restart `npm run dev`.'
        : 'Production: confirm VITE_CRM_URL is set on your host and redeploy the PWA. Redeploy the CRM if /api/mobile-login was recently given CORS headers.',
      'Try another network, disable extensions, or test in a private window.',
    ].filter(Boolean);
    return lines.join(' ');
  }
  return msg;
}

export async function loginWithPhonePassword(phone: string, password: string): Promise<string> {
  const url = getMobileLoginUrl();

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password }),
    });
  } catch (e) {
    throw new Error(explainFetchFailure(url, e));
  }

  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; token?: string };

  if (!res.ok) {
    throw new Error(data?.error || `Login failed (${res.status})`);
  }

  if (!data?.token) {
    throw new Error('Invalid response from server');
  }

  try {
    await signInWithCustomToken(auth, data.token);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m.includes('fetch') || m === 'Failed to fetch') {
      throw new Error(
        'CRM login succeeded but Firebase rejected the token. Check VITE_FIREBASE_* in .env matches your Firebase project and that this site’s domain is allowed under Firebase Auth → Settings → Authorized domains.'
      );
    }
    throw e instanceof Error ? e : new Error(m);
  }

  return data.token;
}
