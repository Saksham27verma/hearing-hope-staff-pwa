import { auth } from '../firebase';

function getCrmUrl(): string {
  return import.meta.env.VITE_CRM_URL || import.meta.env.CRM_BACKEND_URL || 'http://localhost:3000';
}

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
};

export async function fetchAvailableInventory(): Promise<{ ok: boolean; items?: StaffInventoryRow[]; error?: string }> {
  const user = auth.currentUser;
  if (!user) {
    return { ok: false, error: 'Not signed in' };
  }
  const idToken = await user.getIdToken();
  const res = await fetch(`${getCrmUrl().replace(/\/$/, '')}/api/staff/available-inventory`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: (data as { error?: string }).error || 'Failed to load inventory' };
  }
  return { ok: true, items: (data as { items?: StaffInventoryRow[] }).items || [] };
}
