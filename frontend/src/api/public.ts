export interface Mission {
  id: string;
  public_code: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  capacity: number;
  confirmation_phrase: string;
  status: 'DRAFT' | 'OPEN' | 'CLOSED' | 'CANCELLED' | 'COMPLETED';
  confirmed: number;
  waitlist: number;
  available: number;
  is_full: boolean;
  registration_open: boolean;
}

export interface RegistrationResult {
  registration_id: string;
  status: 'CONFIRMED' | 'WAITLIST';
  seat_number: number | null;
  waitlist_position: number | null;
  registration_sequence: number;
  member_id: string;
  name: string;
  message: string;
  mission: {
    public_code: string;
    title: string;
    capacity: number;
    confirmed: number;
    available: number;
  };
}

export async function getMission(publicCode: string): Promise<Mission> {
  const response = await fetch(`/api/missions/${publicCode}`);
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.error?.message || 'فشل في تحميل بيانات المهمة');
  }
  return result.data;
}

export async function lookupMemberId(memberId: string): Promise<{ found: boolean; name?: string }> {
  const response = await fetch(`/api/volunteers/by-member-id/${encodeURIComponent(memberId)}`);
  const result = await response.json();
  if (!response.ok || !result.success) {
    return { found: false };
  }
  return result.data;
}

export async function submitRegistration(formData: FormData): Promise<RegistrationResult> {
  const response = await fetch('/api/register', {
    method: 'POST',
    body: formData,
  });
  
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.error?.message || 'فشل التسجيل في المهمة');
  }
  return result.data;
}
