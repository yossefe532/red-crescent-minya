const TOKEN_KEY = 'rc_admin_token';

function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {}
}

function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['X-Auth-Token'] = token;
  }
  return headers;
}

// ------- Types -------
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
  has_audio_data: number | boolean;
}

// ------- Auth API -------
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
  // Store the session token for subsequent requests
  if (data.data?.token) {
    setToken(data.data.token);
  }
  return { admin_id: data.data.admin_id, username: data.data.username, display_name: data.data.display_name };
}

export async function logoutAdmin(): Promise<void> {
  try {
    await fetch('/api/admin/logout', {
      method: 'POST',
      headers: authHeaders(),
    });
  } catch {}
  clearToken();
}

/** Validate existing token; returns user info or null */
export async function checkSession(): Promise<AdminUser | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch('/api/admin/missions', {
      headers: authHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        return { admin_id: 'active', username: 'admin', display_name: 'مدير النظام' };
      }
    }
    // Token invalid/expired — clear it
    clearToken();
    return null;
  } catch {
    clearToken();
    return null;
  }
}

// ------- Missions API -------
export async function listMissions(): Promise<{ missions: Mission[]; total: number }> {
  const res = await fetch('/api/admin/missions', { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'فشل جلب المهمات');
  }
  return data.data;
}

export async function getMission(id: string): Promise<Mission & { confirmed: number; waitlist: number; available: number }> {
  const res = await fetch(`/api/admin/missions/${id}`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'فشل جلب تفاصيل المهمة');
  }
  return data.data;
}

export async function createMission(payload: MissionCreateData): Promise<MissionCreateResponse> {
  const res = await fetch('/api/admin/missions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'فشل إنشاء المهمة');
  }
  const m = data.data;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://red-crescent-minya.pages.dev';
  const publicUrl = `${origin}/m/${m.public_code}`;
  const whatsappMessage = `🫀 جمعية الهلال الأحمر المصري - فرع المنيا\n\n✅ تم إنشاء مهمة تطوعية جديدة!\n\n📋 كود المهمة: ${m.public_code}\n📝 اسم المهمة: ${m.title}\n💬 عبارة التأكيد: ${m.confirmation_phrase}\n\n🔗 لتسجيل اسمك:\n${publicUrl}`;
  return {
    id: m.id,
    public_code: m.public_code,
    title: m.title,
    confirmation_phrase: m.confirmation_phrase,
    public_url: publicUrl,
    whatsapp_message: whatsappMessage,
  };
}

export async function updateMission(id: string, payload: Partial<Mission>): Promise<Mission> {
  const res = await fetch(`/api/admin/missions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'فشل تحديث المهمة');
  }
  return data.data;
}

export async function deleteMission(id: string): Promise<void> {
  const res = await fetch(`/api/admin/missions/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
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

  const res = await fetch(`/api/admin/missions/${missionId}/registrations?${params.toString()}`, {
    headers: authHeaders(),
  });
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
    headers: authHeaders(),
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
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ open }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'فشل تغيير حالة التسجيل');
  }
  return data.data.mission;
}

// Edit mission details
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
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error?.message || 'فشل تعديل تفاصيل المهمة');
  }
  return data.data.mission;
}
