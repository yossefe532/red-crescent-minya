/**
 * Telegram Bot — Toggle Registration Handler
 * Open/close registration for a mission
 */
import { tgSend, tgEdit, tgAnswerCb, tgSendVoice, tgSendDocument, isAuthorizedChat, getSession, setSession, clearSession, escapeHtml } from '../bot';
import { statusLabel, regStatusLabel, formatDate, formatDateShort, formatMissionDetail, formatMissionListItem, formatVolunteerDetail, formatRegistrationNotification, formatStats, formatHealth, helpText, buildWhatsAppMessage, formatCreateSummary } from '../formatters';
import { mainMenuKeyboard, missionListKeyboard, missionDetailKeyboard, volunteerActionsKeyboard, skipButtonKeyboard, cancelWizardKeyboard, createConfirmKeyboard, confirmActionKeyboard, editFieldKeyboard, notificationSettingsKeyboard, backToMissionKeyboard, backToHomeKeyboard, missionPickerKeyboard } from '../keyboards';
import { getMissionById, updateMission } from '../../services/mission.service';
import { logAudit } from '../../services/audit.service';
import { incrementMissionVersion } from '../../utils/version';

export async function handleToggleRegistration(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string,
  open: boolean
): Promise<void> {
  const mission = await getMissionById(db, missionId);
  if (!mission) {
    await tgSend(token, chatId, '❌ المهمة غير موجودة.');
    return;
  }

  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown> = {};

  if (open) {
    // PREVENT REOPEN: If all confirmed + waitlist spots are full, refuse to reopen
    try {
      const counts = await db.prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END), 0) as confirmed_count,
          COALESCE(SUM(CASE WHEN status = 'WAITLIST' THEN 1 ELSE 0 END), 0) as waitlist_count
        FROM registrations WHERE mission_id = ? AND status IN ('CONFIRMED','WAITLIST')`
      ).bind(missionId).first() as any;
      const cap = mission.capacity || 0;
      const wlCap = mission.waiting_list || 0;
      const isFull = (counts?.confirmed_count || 0) >= cap && (wlCap === 0 || (counts?.waitlist_count || 0) >= wlCap);
      if (isFull) {
        await tgSend(token, chatId,
          `🔒 <b>لا يمكن فتح التسجيل</b>\\n\\n` +
          `📋 <b>${mission.title}</b> (${mission.public_code})\\n` +
          `✅ المؤكدين: ${counts?.confirmed_count || 0}/${cap}\\n` +
          `⏳ قائمة الانتظار: ${counts?.waitlist_count || 0}/${wlCap}\\n\\n` +
          `الكل مقعد مكتمل — التسجيل غير متاح.`,
          { reply_markup: missionDetailKeyboard(missionId, mission.status) }
        );
        return;
      }
    } catch (checkErr) {
      console.error('[TOGGLE] Failed capacity check:', checkErr);
      // Continue with open anyway if check fails (don't block on check error)
    }
    // Open registration: set open_at to now, clear close_at (NULL = open until manually closed)
    updates.registration_open_at = nowIso;
    updates.registration_close_at = null;
    updates.status = 'OPEN';
  } else {
    // Close registration: set close_at to now AND status to CLOSED
    updates.registration_close_at = nowIso;
    updates.status = 'CLOSED';
  }

  try {
    const updatedMission = await updateMission(db, missionId, updates);
    if (!updatedMission) {
      throw new Error('Failed to update mission');
    }

    await logAudit(db, {
      actorId: 'telegram', // TODO: get actual admin ID from session
      actorType: 'admin',
      action: open ? 'REGISTRATION_OPENED' : 'REGISTRATION_CLOSED',
      entityType: 'mission',
      entityId: missionId,
    });

    // Phase 6: Increment mission version for live change detection
    await incrementMissionVersion(db, missionId);

    await tgSend(token, chatId,
      `${open ? '🟢' : '🔴'} <b>تم ${open ? 'فتح' : 'إغلاق'} التسجيل!</b>\n\n` +
      `📋 <b>${mission.title}</b> (${mission.public_code})\n` +
      `📊 الحالة الجديدة: <b>${statusLabel(updatedMission.status)}</b>`,
      { reply_markup: missionDetailKeyboard(missionId, updatedMission.status) }
    );
  } catch (error: any) {
    console.error('Toggle registration failed:', error);
    await tgSend(token, chatId, `❌ فشل تحديث الحالة: ${error.message}`, {
      reply_markup: missionDetailKeyboard(missionId, mission.status)
    });
  }
}