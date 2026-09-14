/**
 * Telegram Bot — Close Mission Handler
 * Closes registration for a mission (set registration_close_at + status=CLOSED).
 */
import { tgSend } from '../bot';
import { getMissionById, updateMission } from '../../services/mission.service';
import { logAudit } from '../../services/audit.service';
import { incrementMissionVersion } from '../../utils/version';
import { missionDetailKeyboard } from '../keyboards';

export async function handleCloseMission(
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
  if (mission.status === 'CLOSED') {
    await tgSend(token, chatId, 'ℹ️ المهمة مغلقة بالفعل.');
    return;
  }

  const nowIso = new Date().toISOString();
  const updated = await updateMission(db, missionId, {
    status: 'CLOSED',
    registration_close_at: nowIso,
  });

  await logAudit(db, {
    actorId: String(adminChatId),
    actorType: 'admin',
    action: 'REGISTRATION_CLOSED',
    entityType: 'mission',
    entityId: missionId,
  });

  // Phase 6: Increment mission version for live change detection
  await incrementMissionVersion(db, missionId);

  await tgSend(token, chatId,
    `🔒 <b>تم إغلاق التسجيل!</b>\n\n📋 <b>${mission.title}</b> (${mission.public_code})\n📊 الحالة الجديدة: مغلقة`,
    { reply_markup: missionDetailKeyboard(missionId, 'CLOSED') }
  );
}