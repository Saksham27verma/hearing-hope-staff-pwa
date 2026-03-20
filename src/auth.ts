import { signInWithCustomToken } from 'firebase/auth';
import { auth } from './firebase';

/**
 * Always same-origin: dev → Vite proxies to CRM; production on Vercel → `api/mobile-login.ts` proxies to CRM.
 */
export function getMobileLoginUrl(): string {
  return '/api/mobile-login';
}

function explainFetchFailure(url: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('Load failed')) {
    const lines = [
      'Could not reach the login endpoint.',
      `Trying: ${url}`,
      import.meta.env.DEV
        ? 'Local dev: set VITE_CRM_URL in .env (CRM base URL), ensure the CRM is running or reachable, then restart `npm run dev`.'
        : 'Production: redeploy this app on Vercel. In Project → Settings → Environment Variables, set CRM_BACKEND_URL to your CRM origin (e.g. https://hearing-hope-crm.vercel.app). VITE_CRM_URL also works as a fallback for the server proxy.',
      'If the response looks like HTML, the SPA rewrite may be intercepting /api — redeploy after updating vercel.json / api/mobile-login.',
    ];
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
