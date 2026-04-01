import { auth } from '../firebase';

function getCrmUrl(): string {
  return import.meta.env.VITE_CRM_URL || import.meta.env.CRM_BACKEND_URL || 'http://localhost:3000';
}

export type FieldOption = {
  optionValue: string;
  optionLabel: string;
  sortOrder: number;
};

export async function fetchStaffEnquiryConfig(): Promise<{
  ok: boolean;
  earSide?: FieldOption[];
  trialLocationType?: FieldOption[];
  hearingTestType?: FieldOption[];
  staffNames?: string[];
  error?: string;
}> {
  const user = auth.currentUser;
  if (!user) return { ok: false, error: 'Not signed in' };
  const idToken = await user.getIdToken();
  const res = await fetch(`${getCrmUrl().replace(/\/$/, '')}/api/staff/enquiry-config`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: (data as { error?: string }).error || 'Failed to load config' };
  }
  const d = data as {
    earSide?: FieldOption[];
    trialLocationType?: FieldOption[];
    hearingTestType?: FieldOption[];
    staffNames?: string[];
  };
  return {
    ok: true,
    earSide: d.earSide,
    trialLocationType: d.trialLocationType,
    hearingTestType: d.hearingTestType,
    staffNames: d.staffNames,
  };
}
