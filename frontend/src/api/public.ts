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

// ── My Registrations (ownership-based) ──
export interface MyRegistration {
  id: string;
  name: string;
  member_id: string | null;
  status: string;
  seat_number: number | null;
  waitlist_position: number | null;
  registration_sequence: number;
  created_at: string;
  cancelled_at: string | null;
}

export async function getMyRegistrations(publicCode: string): Promise<MyRegistration[]> {
  const res = await fetch(`${API_BASE}/missions/${publicCode}/my-registrations`);
  const data = await res.json();
  if (!data.success) return [];
  return data.data || [];
}

export async function selfCancelRegistration(regId: string): Promise<{
  cancelled_registration_id: string;
  promoted_volunteer: { registration_id: string; name: string; new_seat_number: number } | null;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/registrations/${regId}/self-cancel`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'فشل إلغاء التسجيل');
  }
  return data.data;
}

// ── Phase 6: Unified Live Endpoint ──
export interface LiveRosterEntry {
  id: string;
  name: string;
  member_id: string | null;
  status: string;
  seat_number: number | null;
  waitlist_position: number | null;
  created_at: string;
}

export interface LiveMyRegistration {
  id: string;
  status: string;
  seat_number: number | null;
  waitlist_position: number | null;
  created_at: string;
}

export interface LiveMissionResponse {
  changed: boolean;
  version: number;
  mission?: Mission;
  registrations?: LiveRosterEntry[];
  my_registrations?: LiveMyRegistration[];
}

/**
 * Unified live polling endpoint — replaces 4 separate polling mechanisms.
 * Sends current version to detect changes; returns minimal response if unchanged.
 * Ownership token is sent automatically via cookie (ownershipMiddleware).
 */
export async function getLiveMission(
  publicCode: string,
  sinceVersion: number = -1,
): Promise<LiveMissionResponse> {
  const res = await fetch(
    `${API_BASE}/missions/${publicCode}/live?since_version=${sinceVersion}`,
  );
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || 'فشل تحميل بيانات المهمة');
  }
  return data.data;
}
