export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled';

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
}
