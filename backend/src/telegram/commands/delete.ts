/**
 * Telegram Bot — Delete Mission Handler
 * Wizard-based mission deletion with confirmation
 */
import { WizardData } from '../types';
import { tgSend, tgEdit, tgAnswerCb, tgSendVoice, tgSendDocument, isAuthorizedChat, getSession, setSession, clearSession, escapeHtml } from '../bot';
import { statusLabel, regStatusLabel, formatDate, formatDateShort, formatMissionDetail, formatMissionListItem, formatVolunteerDetail, formatRegistrationNotification, formatStats, formatHealth, helpText, buildWhatsAppMessage, formatCreateSummary } from '../formatters';
import { mainMenuKeyboard, missionListKeyboard, missionDetailKeyboard, volunteerActionsKeyboard, skipButtonKeyboard, cancelWizardKeyboard, createConfirmKeyboard, confirmActionKeyboard, editFieldKeyboard, notificationSettingsKeyboard, backToMissionKeyboard, backToHomeKeyboard, missionPickerKeyboard } from '../keyboards';
import { getMissionById, getMissionByPublicCode, listMissions, deleteMission } from '../../services/mission.service';
import { logAudit } from '../../services/audit.service';

// ─── Start Delete Wizard ───────────────────────────────────────
export async function startDeleteWizard(
  token: string,
  chatId: number,
  db: D1Database,
  hint: string | undefined = undefined
): Promise<void> {
  let mission: any = null;
  if (hint) {
    mission = await getMissionByHint(db, hint);
  }

  if (!mission) {
    // Show list of missions to choose from
    const missions = await listMissions(db, { limit: 10, offset: 0 });
    if (!missions.missions.length) {
      await tgSend(token, chatId, '📋 لا توجد مهمات لحذفها.');
      return;
    }

    await setSession(db, chatId, 'delete_confirm', {}); // We'll store missionId in the next step
    await tgSend(token, chatId,
      '🗑️ <b>اختر المهمة لحذفها:</b>',
      { reply_markup: missionPickerKeyboard(
        missions.missions.map(m => ({ id: m.id, public_code: m.public_code, title: m.title, status: m.status })),
        'delete:pick'
      ) }
    );
    return;
  }

  // Store mission data in session and ask for confirmation
  await setSession(db, chatId, 'delete_confirm', {
    missionId: mission.id,
    missionCode: mission.public_code,
    title: mission.title
  });

  await tgSend(token, chatId,
    `⚠️ <b>تأكيد حذف المهمة</b>\n\n` +
    `📋 <b>${mission.title}</b> (${mission.public_code})\n` +
    `📊 الحالة: ${statusLabel(mission.status)}\n\n` +
    `⚠️ <b>سيتم حذف جميع التسجيلات المرتبطة!</b>\n\n` +
    `هل أنت متأكد؟`,
    { reply_markup: confirmActionKeyboard('delete', mission.id) }
  );
}

// Helper: getMissionByHint (we'll need to import or define it)
// Since we don't have it in the mission service, we'll create a helper here.
// Alternatively, we can use the existing findMissionByHint from the old bot? 
// But we are not supposed to duplicate logic. However, we don't have a service for this.
// We'll create a simple one that uses the mission service's getMissionByPublicCode and getMissionById.
// We'll also try to search by title if needed.
// However, to avoid duplication, we can put this in a utils file. But for now, we'll put it here.
// We'll create a separate helper file later if needed.

async function getMissionByHint(db: D1Database, hint: string): Promise<any | null> {
  // Try by public_code (MNY-XXX)
  const codeMatch = hint.match(/MNY-?(\\d+)/i);
  if (codeMatch) {
    const mission = await getMissionByPublicCode(db, `MNY-${codeMatch[1]}`);
    if (mission) return mission;
  }

  // Try by ID (UUID)
  const mission = await getMissionById(db, hint);
  if (mission) return mission;

  // Try by title (exact match first, then partial)
  const missions = await listMissions(db, { limit: 10, offset: 0 });
  const exact = missions.missions.find(m => m.title.trim().toLowerCase() === hint.trim().toLowerCase());
  if (exact) return exact;

  const partial = missions.missions.find(m => 
    m.title.trim().toLowerCase().includes(hint.trim().toLowerCase())
  );
  return partial || null;
}

// ─── Execute Delete ────────────────────────────────────────────
export async function executeDelete(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string
): Promise<void> {
  const mission = await getMissionById(db, missionId);
  if (!mission) {
    await tgSend(token, chatId, '❌ المهمة غير موجودة.');
    return;
  }

  try {
    // Use the official service - SINGLE SOURCE OF TRUTH
    const success = await deleteMission(db, missionId);
    if (!success) {
      throw new Error('Failed to delete mission');
    }

    // Log audit
    await logAudit(db, {
      actorId: 'telegram', // TODO: get actual admin ID from session
      actorType: 'admin',
      action: 'MISSION_DELETED',
      entityType: 'mission',
      entityId: missionId,
      metadata: { title: mission.title, public_code: mission.public_code }
    });

    // Clear session
    await clearSession(db, chatId);

    await tgSend(token, chatId,
      `✅ <b>تم حذف المهمة!</b>\n\n` +
      `🗑️ <b>${mission.title}</b> (${mission.public_code})`,
      { reply_markup: mainMenuKeyboard() }
    );
  } catch (error: any) {
    console.error('Delete mission failed:', error);
    await tgSend(token, chatId, `❌ فشل حذف المهمة: ${error.message}`, {
      reply_markup: mainMenuKeyboard()
    });
  }
}

// ─── Handle Mission Picker for Delete ───────────────────────────
export async function handleDeletePick(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string
): Promise<void> {
  const mission = await getMissionById(db, missionId);
  if (!mission) {
    await tgSend(token, chatId, '❌ المهمة غير موجودة.');
    return;
  }

  // Store mission data in session and ask for confirmation
  await setSession(db, chatId, 'delete_confirm', {
    missionId: mission.id,
    missionCode: mission.public_code,
    title: mission.title
  });

  await tgSend(token, chatId,
    `⚠️ <b>تأكيد حذف المهمة</b>\n\n` +
    `📋 <b>${mission.title}</b> (${mission.public_code})\n` +
    `📊 الحالة: ${statusLabel(mission.status)}\n\n` +
    `⚠️ <b>سيتم حذف جميع التسجيلات المرتبطة!</b>\n\n` +
    `هل أنت متأكد؟`,
    { reply_markup: confirmActionKeyboard('delete', mission.id) }
  );
}