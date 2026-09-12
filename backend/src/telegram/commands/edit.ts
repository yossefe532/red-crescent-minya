/**
 * Telegram Bot — Edit Mission Handler
 * Edit mission fields (title, description, location, capacity, start_at, end_at, waiting_list)
 * Uses ONLY the updateMission service — single source of truth.
 */
import { tgSend, setSession, clearSession } from '../bot';
import { formatMissionDetail } from '../formatters';
import { missionDetailKeyboard, backToHomeKeyboard } from '../keyboards';
import { getMissionById, getMissionAvailability, updateMission } from '../../services/mission.service';
import { logAudit } from '../../services/audit.service';

const FIELD_LABELS: Record<string, string> = {
  title: 'الاسم',
  description: 'الوصف',
  location: 'المقر',
  capacity: 'السعة',
  start_at: 'تاريخ البداية',
  end_at: 'تاريخ النهاية',
  waiting_list: 'قائمة الانتظار',
};

/**
 * Handles the user's text input for editing a mission field.
 */
export async function handleEditValue(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string,
  field: string,
  value: string
): Promise<void> {
  const mission = await getMissionById(db, missionId);
  if (!mission) {
    await tgSend(token, chatId, '❌ المهمة غير موجودة.');
    await clearSession(db, chatId);
    return;
  }

  const trimmed = value.trim();

  // ── Per-field validation ──
  let updates: Record<string, unknown> = {};
  let errorMsg: string | null = null;

  switch (field) {
    case 'title':
      if (trimmed.length < 3) {
        errorMsg = '⚠️ اسم المهمة يجب أن يكون 3 أحرف على الأقل.';
      } else {
        updates.title = trimmed;
      }
      break;

    case 'description':
      updates.description = trimmed || null;
      break;

    case 'location':
      updates.location = trimmed || null;
      break;

    case 'capacity': {
      const cap = parseInt(trimmed, 10);
      if (isNaN(cap) || cap < 1 || cap > 10000) {
        errorMsg = '⚠️ السعة يجب أن تكون رقم بين 1 و 10000.';
      } else {
        updates.capacity = cap;
      }
      break;
    }

    case 'start_at': {
      const d = new Date(trimmed);
      if (isNaN(d.getTime())) {
        errorMsg = '⚠️ تاريخ غير صالح. استخدم الصيغة: 2026-09-15 09:00';
      } else {
        updates.start_at = d.toISOString();
      }
      break;
    }

    case 'end_at': {
      const d = new Date(trimmed);
      if (isNaN(d.getTime())) {
        errorMsg = '⚠️ تاريخ غير صالح. استخدم الصيغة: 2026-09-22 17:00';
      } else {
        updates.end_at = d.toISOString();
      }
      break;
    }

    case 'waiting_list': {
      const wl = parseInt(trimmed, 10);
      if (isNaN(wl) || wl < 0 || wl > 1000) {
        errorMsg = '⚠️ قائمة الانتظار يجب أن تكون رقم بين 0 و 1000.';
      } else {
        updates.waiting_list = wl;
      }
      break;
    }

    default:
      errorMsg = '❌ حقل غير معروف.';
  }

  if (errorMsg) {
    await tgSend(token, chatId, errorMsg + '\n\nاكتب القيمة الجديدة:', {
      reply_markup: backToHomeKeyboard(),
    });
    return;
  }

  // ── Validate date ordering if both dates updated ──
  if (updates.start_at && updates.end_at) {
    if (new Date(updates.start_at as string) >= new Date(updates.end_at as string)) {
      await tgSend(token, chatId, '⚠️ تاريخ البداية يجب أن يكون قبل تاريخ النهاية.');
      return;
    }
  }

  try {
    const updated = await updateMission(db, missionId, updates);
    if (!updated) {
      await tgSend(token, chatId, '❌ فشل تحديث المهمة.');
      return;
    }

    await logAudit(db, {
      actorId: 'telegram',
      actorType: 'admin',
      action: 'MISSION_DETAILS_UPDATED',
      entityType: 'mission',
      entityId: missionId,
      metadata: updates,
    });

    await clearSession(db, chatId);

    // Show updated mission
    const availability = await getMissionAvailability(db, missionId);
    await tgSend(
      token,
      chatId,
      `✅ <b>تم تحديث ${FIELD_LABELS[field]} بنجاح!</b>\n\n` + formatMissionDetail(updated, availability),
      { reply_markup: missionDetailKeyboard(missionId, updated.status) }
    );
  } catch (err: any) {
    console.error('Edit mission failed:', err);
    await tgSend(token, chatId, `❌ فشل التعديل: ${err.message}`, {
      reply_markup: backToHomeKeyboard(),
    });
  }
}