// API base URL
const API_BASE = '/api';

export interface Mission {
  id: string;
  public_code: string;
  title: string;
  description?: string;
  location?: string;
  start_at: string;
  end_at: string;
  capacity: number;
  confirmation_phrase: string;
  status: string;
  confirmed: number;
  waitlist: number;
  available: number;
  is_full: boolean;
  is_completely_full: boolean;
  registration_open: boolean;
  waiting_list?: number;
}

export interface RegistrationResult {
  registration_id: string;
  status: 'CONFIRMED' | 'WAITLIST';
  seat_number: number | null;
  waitlist_position: number | null;
  name: string;
  member_id: string;
  phone?: string;
  mission_code: string;
  mission_title: string;
  message?: string;
}

export interface QuickProfile {
  found: boolean;
  member_id?: string;
  name?: string;
  phone?: string;
}

// Get mission details
export async function getMission(publicCode: string): Promise<Mission> {
  const res = await fetch(`${API_BASE}/missions/${publicCode}`);
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'فشل تحميل بيانات المهمة');
  }
  return data.data;
}

// Lookup volunteer by member ID
export async function lookupMemberId(memberId: string): Promise<{ found: boolean; name?: string }> {
  const res = await fetch(`${API_BASE}/volunteers/by-member-id/${memberId}`);
  const data = await res.json();
  if (!data.success) {
    return { found: false };
  }
  return data.data;
}

// Lookup quick profile
export async function lookupQuickProfile(memberId: string): Promise<QuickProfile> {
  const res = await fetch(`${API_BASE}/quick-profile/lookup/${memberId}`);
  const data = await res.json();
  if (!data.success) {
    return { found: false };
  }
  return data.data;
}

// Save quick profile for future
export async function saveQuickProfile(profile: { member_id: string; name: string; phone: string }) {
  const res = await fetch(`${API_BASE}/quick-profile/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'فشل حفظ البيانات');
  }
  return data.data;
}

// Submit registration (multipart form-data)
export async function submitRegistration(formData: FormData): Promise<RegistrationResult> {
  const res = await fetch(`${API_BASE}/register`, {
    method: 'POST',
    body: formData,
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'فشل إتمام التسجيل');
  }
  return data.data;
}

// Submit temporary registration (without member_id)
export async function submitTemporaryRegistration(payload: {
  mission_public_code: string;
  name: string;
  phone: string;
}): Promise<RegistrationResult> {
  const res = await fetch(`${API_BASE}/register-temporary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'فشل إتمام التسجيل المؤقت');
  }
  return data.data;
}
