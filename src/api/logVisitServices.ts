import { auth } from '../firebase';

function getCrmUrl(): string {
  return import.meta.env.VITE_CRM_URL || import.meta.env.CRM_BACKEND_URL || 'http://localhost:3000';
}

export type VisitServicesPayload = {
  hearingTest?: {
    hearingTestEntries: { id: string; testType: string; price: number }[];
    testDoneBy?: string;
    testResults?: string;
    recommendations?: string;
  };
  accessory?: {
    accessoryName: string;
    accessoryDetails?: string;
    accessoryFOC?: boolean;
    accessoryAmount?: number;
    accessoryQuantity?: number;
  };
  programming?: {
    programmingReason?: string;
    programmingAmount?: number;
    programmingDoneBy?: string;
    hearingAidPurchaseDate?: string;
    hearingAidName?: string;
    underWarranty?: boolean;
    warranty?: string;
  };
  counselling?: {
    notes?: string;
  };
};

export async function submitLogVisitServices(body: {
  appointmentId: string;
  services: VisitServicesPayload;
}): Promise<{ ok: boolean; error?: string; enquiryId?: string }> {
  const user = auth.currentUser;
  if (!user) {
    return { ok: false, error: 'Not signed in' };
  }
  const idToken = await user.getIdToken();
  const res = await fetch(`${getCrmUrl()}/api/appointments/log-visit-services`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: (data as { error?: string }).error || 'Request failed' };
  }
  return { ok: true, enquiryId: (data as { enquiryId?: string }).enquiryId };
}
