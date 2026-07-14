export const config = { runtime: 'edge' };

/**
 * Same-origin proxy: browser → /api/staff/* → {CRM_BACKEND_URL}/api/staff/*
 */
export default async function handler(request: Request): Promise<Response> {
  const crm = (process.env.CRM_BACKEND_URL || process.env.VITE_CRM_URL || '')
    .trim()
    .replace(/\/$/, '');

  if (!crm) {
    return Response.json(
      {
        ok: false,
        error:
          'Server misconfiguration: set CRM_BACKEND_URL on this Vercel project to your CRM origin, then redeploy.',
      },
      { status: 500 }
    );
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const incoming = new URL(request.url);
  const target = `${crm}${incoming.pathname}${incoming.search}`;

  const headers = new Headers();
  const auth = request.headers.get('authorization');
  const contentType = request.headers.get('content-type');
  if (auth) headers.set('Authorization', auth);
  if (contentType) headers.set('Content-Type', contentType);

  const method = request.method.toUpperCase();
  const body =
    method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
    });
    const text = await upstream.text();
    const ct = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
    return new Response(text, {
      status: upstream.status,
      headers: {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return Response.json(
      { ok: false, error: 'Could not reach CRM backend' },
      { status: 502 }
    );
  }
}
