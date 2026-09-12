/**
 * Telegram Bot — Toggle Registration Handler
 * Open/close registration for a mission
 */
import { tgSend, tgEdit, tgAnswerCb, tgSendVoice, tgSendDocument, isAuthorizedChat, getSession, setSession, clearSession, escapeHtml } from '../bot';
import { statusLabel, regStatusLabel, formatDate, formatDateShort, formatMissionDetail, formatMissionListItem, formatVolunteerDetail, formatRegistrationNotification, formatStats, formatHealth, helpText, buildWhatsAppMessage, formatCreateSummary } from '../formatters';
import { mainMenuKeyboard, missionListKeyboard, missionDetailKeyboard, volunteerActionsKeyboard, skipButtonKeyboard, cancelWizardKeyboard, createConfirmKeyboard, confirmActionKeyboard, editFieldKeyboard, notificationSettingsKeyboard, backToMissionKeyboard, backToHomeKeyboard, missionPickerKeyboard } from '../keyboards';
import { getMissionById, updateMission } from '../../services/mission.service';
import { logAudit } from '../../services/audit.service';

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
    // Open registration: set open_at to now, close_at to end_at
    updates.registration_open_at = nowIso;
    updates.registration_close_at = mission.end_at;
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