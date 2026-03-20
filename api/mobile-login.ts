export const config = { runtime: 'edge' };

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Same-origin login proxy: browser → /api/mobile-login → CRM /api/mobile-login.
 * Edge runtime reads the raw POST body and forwards it reliably (no body-parser quirks).
 */
export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  const crm =
    (process.env.CRM_BACKEND_URL || process.env.VITE_CRM_URL || '').trim().replace(/\/$/, '');

  if (!crm) {
    return json(500, {
      ok: false,
      error:
        'Server misconfiguration: set CRM_BACKEND_URL (recommended) or VITE_CRM_URL in this Vercel project, then redeploy.',
    });
  }

  const url = `${crm}/api/mobile-login`;
  const body = await request.text();

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body || '{}',
    });
    const text = await upstream.text();
    const ct = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
    return new Response(text, {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': ct },
    });
  } catch {
    return json(502, { ok: false, error: 'Could not reach CRM backend' });
  }
}

function json(status: number, data: object): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
