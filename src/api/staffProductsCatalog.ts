import { auth } from '../firebase';

function getCrmUrl(): string {
  return import.meta.env.VITE_CRM_URL || import.meta.env.CRM_BACKEND_URL || 'http://localhost:3000';
}

export type CatalogProduct = {
  id: string;
  name: string;
  type: string;
  company: string;
  mrp?: number;
  gstApplicable?: boolean;
  gstPercentage?: number;
  hsnCode?: string;
};

export async function fetchStaffProductsCatalog(q?: string): Promise<{
  ok: boolean;
  products?: CatalogProduct[];
  error?: string;
}> {
  const user = auth.currentUser;
  if (!user) return { ok: false, error: 'Not signed in' };
  const idToken = await user.getIdToken();
  const url = new URL(`${getCrmUrl().replace(/\/$/, '')}/api/staff/products-catalog`);
  if (q?.trim()) url.searchParams.set('q', q.trim());
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: (data as { error?: string }).error || 'Failed to load products' };
  }
  return { ok: true, products: (data as { products?: CatalogProduct[] }).products ?? [] };
}
