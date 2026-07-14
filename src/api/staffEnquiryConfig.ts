import { auth } from '../firebase';
import { crmFetch } from './crmBase';

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
  try {
    const res = await crmFetch('/api/staff/enquiry-config', {
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
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to load config' };
  }
}
