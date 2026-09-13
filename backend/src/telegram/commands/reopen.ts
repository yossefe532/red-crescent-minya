/**
 * Telegram Bot — Reopen Mission Handler
 * Reopens registration for a CLOSED mission.
 * Sets registration_open_at=now, registration_close_at=null, status=OPEN.
 */
import { tgSend } from '../bot';
import { getMissionById, updateMission } from '../../services/mission.service';
import { logAudit } from '../../services/audit.service';
import { missionDetailKeyboard } from '../keyboards';

export async function handleReopenMission(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string,
  adminChatId: number
): Promise<void> {
  const mission = await getMissionById(db, missionId);
  if (!mission) {
    await tgSend(token, chatId, '❌ المهمة غير موجودة.');
    return;
  }
  if (mission.status !== 'CLOSED') {
    await tgSend(token, chatId, `ℹ️ المهمة حالتها: ${mission.status} — لا يمكن إعادة الفتح إلا للمهام المغلقة.`);
    return;
  }

  const nowIso = new Date().toISOString();
  const updated = await updateMission(db, missionId, {
    status: 'OPEN',
    registration_open_at: nowIso,
    registration_close_at: null,
  });

  await logAudit(db, {
    actorId: String(adminChatId),
    actorType: 'admin',
    action: 'MISSION_REOPENED',
    entityType: 'mission',
    entityId: missionId,
  });

  await tgSend(token, chatId,
    `🔓 <b>تم إعادة فتح المهمة!</b>\n\n📋 <b>${mission.title}</b> (${mission.public_code})\n📊 الحالة الجديدة: مفتوحة`,
    { reply_markup: missionDetailKeyboard(missionId, 'OPEN') }
  );
}