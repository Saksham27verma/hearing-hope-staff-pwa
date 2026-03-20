import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Same-origin login proxy: browser → this app /api/mobile-login → CRM /api/mobile-login.
 * Avoids cross-origin fetch issues (CORS, strict tracking prevention, some extensions).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const crm =
    process.env.CRM_BACKEND_URL?.trim() ||
    process.env.VITE_CRM_URL?.trim() ||
    '';

  if (!crm) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({
      ok: false,
      error:
        'Server misconfiguration: set CRM_BACKEND_URL (recommended) or VITE_CRM_URL in this Vercel project’s Environment Variables, then redeploy.',
    });
  }

  const url = `${crm.replace(/\/$/, '')}/api/mobile-login`;
  const rawBody =
    typeof req.body === 'string' ? req.body : req.body != null ? JSON.stringify(req.body) : '{}';

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody,
    });
    const text = await upstream.text();
    const ct = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
    res.status(upstream.status);
    res.setHeader('Content-Type', ct);
    return res.send(text);
  } catch {
    res.setHeader('Content-Type', 'application/json');
    return res.status(502).json({ ok: false, error: 'Could not reach CRM backend' });
  }
}
