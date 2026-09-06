export interface AdminUser {
  admin_id: string;
  username: string;
  display_name: string | null;
}

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
  registration_open_at: string | null;
  registration_close_at: string | null;
  created_at: string;
}

export interface MissionCreateData {
  title: string;
  description?: string;
  location?: string;
  start_at: string;
  end_at: string;
  capacity: number;
}

export interface MissionCreateResponse {
  id: string;
  public_code: string;
  title: string;
  confirmation_phrase: string;
  public_url: string;
  whatsapp_message: string;
}

export interface Registration {
  id: string;
  mission_id: string;
  volunteer_id: string;
  status: 'CONFIRMED' | 'WAITLIST' | 'CANCELLED';
  seat_number: number | null;
  waitlist_position: number | null;
  registration_sequence: number;
  created_at: string;
  confirmed_at: string | null;
  volunteer_name: string;
  member_id: string;
  audio_id: string | null;
  phrase: string | null;
  duration_ms: number | null;
}

export async function loginAdmin(username: string, password: string): Promise<AdminUser> {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'فشل تسجيل الدخول');
  }
  return data.data;
}

export async function logoutAdmin(): Promise<void> {
  await fetch('/api/admin/logout', { method: 'POST' });
}

export async function listMissions(): Promise<{ missions: Mission[]; total: number }> {
  const res = await fetch('/api/admin/missions');
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'فشل جلب المهمات');
  }
  return data.data;
}

export async function getMission(id: string): Promise<Mission & { confirmed: number; waitlist: number; available: number }> {
  const res = await fetch(`/api/admin/missions/${id}`);
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'فشل جلب تفاصيل المهمة');
  }
  return data.data;
}

export async function createMission(payload: MissionCreateData): Promise<MissionCreateResponse> {
  const res = await fetch('/api/admin/missions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'فشل إنشاء المهمة');
  }
  return data.data;
}

export async function updateMission(id: string, payload: Partial<Mission>): Promise<Mission> {
  const res = await fetch(`/api/admin/missions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'فشل تحديث المهمة');
  }
  return data.data;
}

export async function deleteMission(id: string): Promise<void> {
  const res = await fetch(`/api/admin/missions/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'فشل حذف المهمة');
  }
}

export async function getMissionRegistrations(missionId: string, query?: { status?: string; search?: string }): Promise<{
  registrations: Registration[];
  total: number;
  confirmed: number;
  waitlist: number;
  cancelled: number;
}> {
  const params = new URLSearchParams();
  if (query?.status) params.set('status', query.status);
  if (query?.search) params.set('search', query.search);

  const res = await fetch(`/api/admin/missions/${missionId}/registrations?${params.toString()}`);
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'فشل جلب قائمة المتطوعين');
  }
  return data.data;
}

export async function cancelRegistration(registrationId: string): Promise<{
  cancelled_registration_id: string;
  promoted_volunteer?: { name: string; member_id: string; new_seat_number: number } | null;
  message: string;
}> {
  const res = await fetch(`/api/admin/registrations/${registrationId}/cancel`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'فشل إلغاء التسجيل');
  }
  return data.data;
}

export function getAudioPlaybackUrl(registrationId: string): string {
  return `/api/admin/registrations/${registrationId}/audio`;
}

export function getExportCsvUrl(missionId: string): string {
  return `/api/admin/missions/${missionId}/export`;
}

// Toggle registration open/close
export async function toggleMissionRegistration(missionId: string, open: boolean): Promise<Mission> {
  const res = await fetch(`/api/admin/missions/${missionId}/toggle-registration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ open }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'فشل تغيير حالة التسجيل');
  }
  return data.data.mission;
}

// Edit mission details (title, description, location, capacity, dates)
export async function updateMissionDetails(missionId: string, payload: {
  title?: string;
  description?: string | null;
  location?: string | null;
  capacity?: number;
  start_at?: string;
  end_at?: string;
}): Promise<Mission> {
  const res = await fetch(`/api/admin/missions/${missionId}/details`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'فشل تعديل تفاصيل المهمة');
  }
  return data.data.mission;
}
