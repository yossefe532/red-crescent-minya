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
        `🔒 <b>لا يمكن إعادة فتح المهمة</b>\\n\\n` +
        `📋 <b>${mission.title}</b> (${mission.public_code})\\n` +
        `✅ المؤكدين: ${counts?.confirmed_count || 0}/${cap}\\n` +
        `⏳ قائمة الانتظار: ${counts?.waitlist_count || 0}/${wlCap}\\n\\n` +
        `الكل مقعد مكتمل — التسجيل غير متاح.`,
        { reply_markup: missionDetailKeyboard(missionId, 'CLOSED') }
      );
      return;
    }
  } catch (checkErr) {
    console.error('[REOPEN] Failed capacity check:', checkErr);
    // Continue with reopen anyway if check fails
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