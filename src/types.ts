export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled';

export type ComplianceStatus =
  | 'awaiting_telecaller_pin'
  | 'pending_verification'
  | 'incomplete_compliance'
  | 'completed';

export type ComplianceFormData = {
  wearingIdUniformBag: boolean;
  sharedPersonalContact: boolean;
  focHomeVisitsCommitted: number;
  freeBatteryBoxesCommitted: boolean;
  freeBatteryBoxesQty?: number | null;
  explainedAccessoriesCharges: boolean;
  explainedWarranty: boolean;
  connectedWithTelecaller: true;
};

export type GpsLocation = {
  lat: number;
  lng: number;
  accuracy?: number | null;
  capturedAt: string;
};

export type CheckoutDraft = {
  services?: Record<string, unknown> | null;
  servicesSkipped?: boolean;
  commerce?: {
    receiptType: 'booking' | 'trial' | 'invoice';
    amount: number;
    paymentMode: 'cash' | 'upi' | 'card';
    details: Record<string, unknown>;
    summaryLines?: string[];
    savedAt?: string;
  } | null;
  commerceSkipped?: boolean;
  gps_location?: GpsLocation | null;
  compliance_form_data?: ComplianceFormData | null;
  feedback?: string;
};

export interface Appointment {
  id: string;
  title?: string;
  enquiryId?: string;
  patientName?: string;
  patientPhone?: string;
  reference?: string;
  type: 'center' | 'home';
  centerId?: string;
  centerName?: string;
  address?: string;
  homeVisitorStaffId?: string;
  homeVisitorName?: string;
  assignedStaffId?: string;
  assignedStaffName?: string;
  telecaller?: string;
  notes?: string;
  start: string;
  end: string;
  status?: AppointmentStatus;
  feedback?: string;
  telecaller_pin?: string | null;
  telecaller_verified?: boolean;
  gps_location?: GpsLocation | null;
  compliance_form_data?: ComplianceFormData | null;
  complianceStatus?: ComplianceStatus | null;
  checkoutDraft?: CheckoutDraft | null;
  checkoutReadyForPin?: boolean;
}
