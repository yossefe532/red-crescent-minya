/**
 * Telegram Bot — Message Formatters
 * All message formatting, status labels, date formatting.
 */
import { escapeHtml } from './bot';

// ─── Status Labels ─────────────────────────────────────────────
const STATUS_EMOJI: Record<string, string> = {
  DRAFT: '📝', OPEN: '🟢', CLOSED: '🔴', CANCELLED: '❌', COMPLETED: '✅',
};
const STATUS_AR: Record<string, string> = {
  DRAFT: 'مسودة', OPEN: 'مفتوحة', CLOSED: 'مغلقة', CANCELLED: 'ملغاة', COMPLETED: 'مكتملة',
};
const REG_STATUS_AR: Record<string, string> = {
  CONFIRMED: 'مؤكد', WAITLIST: 'قائمة انتظار', CANCELLED: 'ملغي', PENDING: 'قيد الانتظار',
};

export function statusLabel(status: string): string {
  return `${STATUS_EMOJI[status] || '❓'} ${STATUS_AR[status] || status}`;
}

export function regStatusLabel(status: string): string {
  return REG_STATUS_AR[status] || status;
}

// ─── Date Formatting ───────────────────────────────────────────
export function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return isoString;
  }
}

export function formatDateShort(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short' });
  } catch {
    return isoString;
  }
}

// ─── Mission Detail Message ────────────────────────────────────
export function formatMissionDetail(
  mission: any,
  availability: { confirmed: number; waitlist: number; capacity: number; waiting_list: number; available: number; waitlist_available: number }
): string {
  const frontendUrl = 'https://red-crescent-minya.pages.dev';
  const regLink = `${frontendUrl}/m/${mission.public_code}`;

  return `📋 <b>تفاصيل المهمة ${mission.public_code}</b>\n`
    + `━━━━━━━━━━━━━━━━━\n\n`
    + `📝 <b>الاسم:</b> ${escapeHtml(mission.title)}\n`
    + (mission.description ? `📄 <b>الوصف:</b> ${escapeHtml(mission.description)}\n` : '')
    + `📍 <b>المقر:</b> ${escapeHtml(mission.location) || '—'}\n`
    + `📅 <b>البداية:</b> ${formatDate(mission.start_at)}\n`
    + `📅 <b>النهاية:</b> ${formatDate(mission.end_at)}\n`
    + `📊 <b>الحالة:</b> ${statusLabel(mission.status)}\n\n`
    + `👥 <b>المؤكدون:</b> ${availability.confirmed}/${availability.capacity}`
    + ` (${availability.available} متاح)\n`
    + `⏳ <b>الانتظار:</b> ${availability.waitlist}/${availability.waiting_list || 0}`
    + ` (${availability.waitlist_available} متاح)\n\n`
    + `🔗 <b>رابط التسجيل:</b>\n<code>${regLink}</code>`;
}

// ─── Mission List Item ─────────────────────────────────────────
export function formatMissionListItem(
  mission: any,
  confirmed: number,
  capacity: number,
  waitlist: number,
  waitingList: number
): string {
  return `📌 <b>${escapeHtml(mission.title)}</b> (${mission.public_code})\n`
    + `📅 ${formatDateShort(mission.start_at)}\n`
    + `👥 Confirmed: ${confirmed}/${capacity}\n`
    + `⏳ Waiting: ${waitlist}/${waitingList || 0}\n`
    + `🔓 Registration: ${statusLabel(mission.status)}`;
}

// ─── Volunteer Detail ──────────────────────────────────────────
export function formatVolunteerDetail(
  reg: any,
  hasAudio: boolean,
  audioDurationSec: number
): string {
  return `👤 <b>تفاصيل المتطوع</b>\n`
    + `━━━━━━━━━━━━━━━━━\n\n`
    + `📝 <b>الاسم:</b> ${escapeHtml(reg.name)}\n`
    + `🏷️ <b>رقم العضوية:</b> ${reg.member_id}\n`
    + `📱 <b>التليفون:</b> ${reg.phone || 'غير مسجل'}\n`
    + `📅 <b>وقت التسجيل:</b> ${formatDate(reg.created_at)}\n`
    + `📋 <b>المهمة:</b> ${escapeHtml(reg.title)} (${reg.public_code})\n`
    + `📊 <b>الحالة:</b> ${regStatusLabel(reg.status)}`
    + (reg.waitlist_position ? `\n⏳ <b>رقم الانتظار:</b> #${reg.waitlist_position}` : '')
    + (reg.seat_number ? `\n💺 <b>رقم المقعد:</b> ${reg.seat_number}` : '')
    + `\n\n`
    + (hasAudio
      ? `🎙️ <b>يوجد تسجيل صوتي</b>${audioDurationSec ? ` (${audioDurationSec} ث)` : ''}`
      : `🔇 <b>لا يوجد تسجيل صوتي</b>`);
}

// ─── Registration Notification ─────────────────────────────────
export function formatRegistrationNotification(data: {
  name: string;
  memberId: string;
  phone?: string;
  missionTitle: string;
  missionCode: string;
  status: string;
  seatNumber?: number | null;
  waitlistPosition?: number | null;
}): string {
  const statusEmoji = data.status === 'CONFIRMED' ? '✅' : '⏳';
  return `🆕 <b>تسجيل جديد</b>\n`
    + `━━━━━━━━━━━━━━━━━\n\n`
    + `👤 <b>الاسم:</b> ${escapeHtml(data.name)}\n`
    + `🪪 <b>رقم العضوية:</b> ${data.memberId}\n`
    + (data.phone ? `📱 <b>التليفون:</b> ${data.phone}\n` : '')
    + `📌 <b>المهمة:</b> ${escapeHtml(data.missionTitle)} (${data.missionCode})\n`
    + `📊 <b>الحالة:</b> ${statusEmoji} ${regStatusLabel(data.status)}`
    + (data.seatNumber ? `\n💺 <b>المقعد:</b> ${data.seatNumber}` : '')
    + (data.waitlistPosition ? `\n⏳ <b>رقم الانتظار:</b> #${data.waitlistPosition}` : '');
}

// ─── Stats Message ─────────────────────────────────────────────
export function formatStats(stats: {
  totalMissions: number;
  openMissions: number;
  totalRegistrations: number;
  confirmed: number;
  waitlist: number;
  cancelled: number;
}): string {
  return `📊 <b>إحصائيات النظام</b>\n`
    + `━━━━━━━━━━━━━━━━━\n\n`
    + `📋 <b>المهمات:</b> ${stats.totalMissions} (🟢 نشطة: ${stats.openMissions})\n`
    + `📝 <b>التسجيلات:</b> ${stats.totalRegistrations}\n`
    + `✅ <b>مؤكدة:</b> ${stats.confirmed}\n`
    + `⏳ <b>انتظار:</b> ${stats.waitlist}\n`
    + `❌ <b>ملغاة:</b> ${stats.cancelled}`;
}

// ─── Health Check Message ──────────────────────────────────────
export function formatHealth(checks: {
  backend: boolean;
  database: boolean;
  bot: boolean;
  notifications: boolean;
  missionCount: number;
  registrationCount: number;
}): string {
  const icon = (ok: boolean) => ok ? '🟢' : '🔴';
  const now = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
  return `❤️ <b>حالة النظام</b>\n`
    + `━━━━━━━━━━━━━━━━━\n\n`
    + `${icon(checks.backend)} <b>Backend:</b> ${checks.backend ? 'شغال' : 'مشكلة'}\n`
    + `${icon(checks.database)} <b>Database:</b> ${checks.database ? 'شغال' : 'مشكلة'}\n`
    + `${icon(checks.bot)} <b>Telegram Bot:</b> ${checks.bot ? 'شغال' : 'مشكلة'}\n`
    + `${icon(checks.notifications)} <b>الإشعارات:</b> ${checks.notifications ? 'مفعّلة' : 'متوقفة'}\n\n`
    + `📊 المهمات: ${checks.missionCount}\n`
    + `📝 التسجيلات: ${checks.registrationCount}\n`
    + `⏰ ${now}`;
}

// ─── Help Text ─────────────────────────────────────────────────
export function helpText(): string {
  return `🤖 <b>مساعد إدارة مهام الهلال الأحمر — المنيا</b>\n`
    + `━━━━━━━━━━━━━━━━━\n\n`
    + `<b>📝 إنشاء مهمة:</b>\n`
    + `  • "اعمل مهمة" أو "مهمة جديدة"\n\n`
    + `<b>📋 عرض المهمات:</b>\n`
    + `  • "شوف المهمات" أو "المهمات النشطة"\n\n`
    + `<b>📊 إحصائيات:</b>\n`
    + `  • "إحصائيات"\n\n`
    + `<b>🔓 فتح/إغلاق:</b>\n`
    + `  • "افتح مهمة MNY-123"\n`
    + `  • "اقفل مهمة MNY-123"\n\n`
    + `<b>✏️ تعديل مهمة:</b>\n`
    + `  • "عدّل مهمة MNY-123"\n\n`
    + `<b>🗑️ حذف مهمة:</b>\n`
    + `  • "امسح مهمة MNY-123"\n\n`
    + `<b>❌ إلغاء تسجيل:</b>\n`
    + `  • "شيل متطوع رقم عضوية 123 من MNY-123"\n\n`
    + `<b>👥 المسجلين:</b>\n`
    + `  • "المسجلين في MNY-123"\n\n`
    + `<b>⏳ قائمة الانتظار:</b>\n`
    + `  • "الانتظار في MNY-123"\n\n`
    + `<b>🔗 رابط التسجيل:</b>\n`
    + `  • "رابط MNY-123"\n\n`
    + `<b>📥 تصدير:</b>\n`
    + `  • "تصدير MNY-123"\n\n`
    + `━━━━━━━━━━━━━━━━━\n`
    + `💡 أو استخدم الأزرار بالأسفل 👇`;
}

// ─── WhatsApp Message Builder ──────────────────────────────────
export function buildWhatsAppMessage(mission: any): string {
  const url = `https://red-crescent-minya.pages.dev/m/${mission.public_code}`;
  return `🔴 *الهلال الأحمر المصري — فرع المنيا*\n\n`
    + `📋 *${mission.title}*\n`
    + (mission.description ? `📄 ${mission.description}\n` : '')
    + `📍 المكان: ${mission.location || 'سيتم تحديده'}\n`
    + `📅 الموعد: ${formatDate(mission.start_at)}\n`
    + `👥 العدد المطلوب: ${mission.capacity}\n\n`
    + `🔗 *سجّل من هنا:*\n${url}\n\n`
    + `⚠️ التسجيل الصوتي إلزامي لتأكيد المشاركة.`;
}

// ─── Create Mission Summary ────────────────────────────────────
export function formatCreateSummary(data: {
  title?: string;
  description?: string | null;
  location?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  capacity?: number;
  waiting_list?: number;
}): string {
  return `📋 <b>ملخص المهمة الجديدة</b>\n`
    + `━━━━━━━━━━━━━━━━━\n\n`
    + `📝 <b>الاسم:</b> ${escapeHtml(data.title) || '—'}\n`
    + `📄 <b>الوصف:</b> ${escapeHtml(data.description) || '—'}\n`
    + `📍 <b>المقر:</b> ${escapeHtml(data.location) || '—'}\n`
    + `📅 <b>البداية:</b> ${formatDate(data.start_at)}\n`
    + `📅 <b>النهاية:</b> ${formatDate(data.end_at)}\n`
    + `👥 <b>السعة:</b> ${data.capacity || 0} متطوع\n`
    + `⏳ <b>الانتظار:</b> ${data.waiting_list || 0}\n\n`
    + `هل تريد إنشاء المهمة؟`;
}
