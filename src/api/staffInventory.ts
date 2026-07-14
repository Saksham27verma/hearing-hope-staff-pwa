import { auth } from '../firebase';
import { crmFetch } from './crmBase';

export type StaffInventoryRow = {
  lineId: string;
  productId: string;
  name: string;
  company: string;
  type: string;
  mrp: number;
  dealerPrice: number;
  serialNumber: string;
  hasSerialNumber: boolean;
  gstApplicable?: boolean;
  gstPercent?: number;
};

export async function fetchAvailableInventory(): Promise<{
  ok: boolean;
  items?: StaffInventoryRow[];
  error?: string;
}> {
  const user = auth.currentUser;
  if (!user) {
    return { ok: false, error: 'Not signed in' };
  }
  const idToken = await user.getIdToken();
  try {
    const res = await crmFetch('/api/staff/available-inventory', {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: (data as { error?: string }).error || 'Failed to load inventory' };
    }
    return { ok: true, items: (data as { items?: StaffInventoryRow[] }).items || [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to load inventory' };
  }
}
