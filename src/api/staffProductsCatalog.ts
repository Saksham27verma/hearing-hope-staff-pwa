import { auth } from '../firebase';
import { crmFetch } from './crmBase';

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
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  try {
    const res = await crmFetch(`/api/staff/products-catalog${qs}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: (data as { error?: string }).error || 'Failed to load products' };
    }
    return { ok: true, products: (data as { products?: CatalogProduct[] }).products ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to load products' };
  }
}
