/**
 * Telegram Bot — Central Callback Dispatcher
 * Routes ALL callback_query actions to their handlers.
 */
import { tgSend, tgAnswerCb, clearSession, getSession, setSession } from './bot';
import {
  mainMenuKeyboard,
  backToHomeKeyboard,
  editFieldKeyboard,
  notificationSettingsKeyboard,
  skipButtonKeyboard,
} from './keyboards';
import { helpText, statusLabel, formatHealth } from './formatters';
import { startCommandHandler, helpCommandHandler, cancelCommandHandler } from './commands/start';
import {
  handleListMissions,
  handleStats,
  handleMissionDetail,
  handleGetLink,
  handleWhatsAppMessage,
  handleExportCSV,
} from './commands/missions';
import { startCreateWizard, executeCreateMission } from './commands/create';
import { handleToggleRegistration } from './commands/toggle';
import { handleDeletePick, executeDelete, startDeleteWizard } from './commands/delete';
import {
  handleRegistrants,
  handleWaitlist,
  handleVolunteerDetail,
  handleVolunteerAudio,
  handleVolunteerMove,
} from './commands/registrants';
import {
  startCancelWizard,
  handleCancelMissionPick,
  handleCancelVolunteerSelect,
  handleCancelRegConfirm,
} from './commands/cancel-reg';
import { getMissionById, getMissionByPublicCode } from '../services/mission.service';
import { getMissionAvailability, formatMissionDetail } from './commands/missions';
import { missionDetailKeyboard } from './keyboards';

// ─── Field labels for edit prompts ───────────────────────────────
const EDIT_FIELD_LABELS: Record<string, string> = {
  title: 'الاسم',
  description: 'الوصف',
  location: 'المقر',
  capacity: 'السعة',
  start_at: 'تاريخ البداية',
  end_at: 'تاريخ النهاية',
  waiting_list: 'قائمة الانتظار',
};

// ═══════════════════════════════════════════════════════════════════
// Main Callback Handler
// ═══════════════════════════════════════════════════════════════════
export async function handleCallbackQuery(
  token: string,
  chatId: number,
  db: D1Database,
  callbackQuery: any
): Promise<void> {
  const data: string | undefined = callbackQuery.data;
  if (!data) return;

  // Always answer the callback to remove the loading spinner
  await tgAnswerCb(token, callbackQuery.id);

  // Special case: no-op
  if (data === 'noop') return;

  // Parse prefix:rest
  const colonIdx = data.indexOf(':');
  if (colonIdx === -1) return;

  const prefix = data.substring(0, colonIdx);
  const rest = data.substring(colonIdx + 1);
  const parts = rest.split(':');

  try {
    // ═══════════════════════════════════════════
    // m:detail:MNY-XXX — click on mission from picker
    // ═══════════════════════════════════════════
    if (prefix === 'm' && parts[0] === 'detail') {
      // parts[1] = public_code like "MNY-957"
      await handleMissionDetail(token, chatId, db, parts[1]);
      return;
    }

    // ═══════════════════════════════════════════
    // m:public_code — direct by public code
    // ═══════════════════════════════════════════
    if (prefix === 'm' && parts.length === 2 && /MNY-?\d+/i.test(parts[1])) {
      const mission = await getMissionByPublicCode(db, parts[1]);
      if (mission) {
        const availability = await getMissionAvailability(db, mission.id);
        await tgSend(token, chatId, formatMissionDetail(mission, availability), {
          reply_markup: missionDetailKeyboard(mission.id, mission.status ?? 'DRAFT')
        });
        return;
      }
    }

    switch (prefix) {
      case 'nav':
        await handleNav(token, chatId, db, parts);
        break;
      case 'm':
        await handleMission(token, chatId, db, parts);
        break;
      case 'v':
        await handleVolunteer(token, chatId, db, parts);
        break;
      case 'wiz':
        await handleWizardCallback(token, chatId, db, parts);
        break;
      case 'confirm':
        await handleConfirm(token, chatId, db, parts);
        break;
      case 'edit':
        await handleEdit(token, chatId, db, parts);
        break;
      case 'delete':
        await handleDelete(token, chatId, db, parts);
        break;
      case 'cancelreg':
        await handleCancelReg(token, chatId, db, parts);
        break;
      case 'notify':
        await handleNotify(token, chatId, db, parts);
        break;
      default:
        console.warn('Unknown callback prefix:', prefix);
    }
  } catch (err: any) {
    console.error('[TG_CALLBACK] Error:', err);
    await tgSend(
      token,
      chatId,
      '❌ حدث خطأ غير متوقع. جرب /start',
      { reply_markup: mainMenuKeyboard() }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// nav:* — Navigation
// ═══════════════════════════════════════════════════════════════════
async function handleNav(
  token: string,
  chatId: number,
  db: D1Database,
  parts: string[]
): Promise<void> {
  const action = parts[0];

  switch (action) {
    case 'home':
      await startCommandHandler(token, chatId, db);
      break;

    case 'missions': {
      // nav:missions or nav:missions:active
      const onlyActive = parts[1] === 'active';
      await handleListMissions(token, chatId, db, undefined as any, onlyActive);
      break;
    }

    case 'create':
      await startCreateWizard(token, chatId, db);
      break;

    case 'stats':
      await handleStats(token, chatId, db);
      break;

    case 'help':
      await helpCommandHandler(token, chatId, db);
      break;

    case 'notifications': {
      const row = await db
        .prepare("SELECT value FROM settings WHERE key = 'notifications_enabled'")
        .first<{ value: string }>();
      const isOn = row?.value === '1' || row?.value === 'true';
      await tgSend(
        token,
        chatId,
        `🔔 <b>إعدادات الإشعارات</b>\n\nالحالة الحالية: ${isOn ? '🟢 مفعّلة' : '🔴 متوقفة'}`,
        { reply_markup: notificationSettingsKeyboard(isOn) }
      );
      break;
    }

    case 'health': {
      try {
        const missionCount = await db
          .prepare('SELECT COUNT(*) as c FROM missions')
          .first<{ c: number }>();
        const regCount = await db
          .prepare('SELECT COUNT(*) as c FROM registrations')
          .first<{ c: number }>();
        const notifRow = await db
          .prepare("SELECT value FROM settings WHERE key = 'notifications_enabled'")
          .first<{ value: string }>();

        await tgSend(
          token,
          chatId,
          formatHealth({
            backend: true,
            database: true,
            bot: true,
            notifications: notifRow?.value === '1',
            missionCount: missionCount?.c ?? 0,
            registrationCount: regCount?.c ?? 0,
          }),
          { reply_markup: backToHomeKeyboard() }
        );
      } catch (e) {
        console.error('Health check failed:', e);
        await tgSend(token, chatId, '❌ فشل فحص الحالة.', {
          reply_markup: backToHomeKeyboard(),
        });
      }
      break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// m:* — Mission Actions
// ═══════════════════════════════════════════════════════════════════
async function handleMission(
  token: string,
  chatId: number,
  db: D1Database,
  parts: string[]
): Promise<void> {
  const action = parts[0];
  const missionId = parts[1];

  switch (action) {
    case 'detail':
      if (missionId) await handleMissionDetail(token, chatId, db, missionId);
      break;
    case 'detail_pub':
      // m:detail_pub:MNY-XXX from missionPickerKeyboard
      await handleMissionByPublicCode(token, chatId, db, missionId);
      break;
    case 'regs':
      if (missionId) await handleRegistrants(token, chatId, db, missionId);
      break;
    case 'wait':
      if (missionId) await handleWaitlist(token, chatId, db, missionId);
      break;
    case 'close':
      if (missionId) await handleToggleRegistration(token, chatId, db, missionId, false);
      break;
    case 'open':
      if (missionId) await handleToggleRegistration(token, chatId, db, missionId, true);
      break;
    case 'link':
      if (missionId) await handleGetLink(token, chatId, db, missionId);
      break;
    case 'whatsapp':
      if (missionId) await handleWhatsAppMessage(token, chatId, db, missionId);
      break;
    case 'edit':
      if (missionId) {
        await tgSend(
          token,
          chatId,
          '✏️ <b>اختر الحقل للتعديل:</b>',
          { reply_markup: editFieldKeyboard(missionId) }
        );
      }
      break;
    case 'export':
      if (missionId) await handleExportCSV(token, chatId, db, missionId);
      break;
    case 'delete':
      if (missionId) await startDeleteWizard(token, chatId, db, missionId);
      break;
    case 'delete_pick':
      if (missionId) await executeDelete(token, chatId, db, missionId);
      break;
  }
}

async function handleMissionByPublicCode(
  token: string,
  chatId: number,
  db: D1Database,
  publicCode: string
): Promise<void> {
  try {
    const code = publicCode.match(/MNY-?\d+/i) ? publicCode.replace(/MNY-?(\d+)/i, 'MNY-$1') : publicCode;
    const mission = await getMissionByPublicCode(db, code);
    if (mission) {
      const availability = await getMissionAvailability(db, mission.id);
      await tgSend(token, chatId, formatMissionDetail(mission, availability), {
        reply_markup: missionDetailKeyboard(mission.id, mission.status ?? 'DRAFT')
      });
    } else {
      await tgSend(token, chatId, '❌ المهمة غير موجودة.');
    }
  } catch (err: any) {
    console.error('[handleMissionByPublicCode]', err);
    await tgSend(token, chatId, `❌ خطأ: ${err?.message || String(err)}`, { reply_markup: mainMenuKeyboard() });
  }
}

// ═══════════════════════════════════════════════════════════════════
// v:* — Volunteer Actions
// ═══════════════════════════════════════════════════════════════════
async function handleVolunteer(
  token: string,
  chatId: number,
  db: D1Database,
  parts: string[]
): Promise<void> {
  const action = parts[0];
  const regId = parts[1];

  switch (action) {
    case 'detail':
      if (regId) await handleVolunteerDetail(token, chatId, db, regId);
      break;
    case 'audio':
      if (regId) await handleVolunteerAudio(token, chatId, db, regId);
      break;
    case 'move': {
      const targetStatus = parts[2] as 'CONFIRMED' | 'WAITLIST';
      if (regId && targetStatus) {
        await handleVolunteerMove(token, chatId, db, regId, targetStatus);
      }
      break;
    }
    case 'cancel': {
      if (regId) {
        // Directly execute cancel — the v:cancel action is a definitive user action
        await handleCancelRegConfirm(token, chatId, db, regId);
      }
      break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// wiz:* — Wizard Callback Actions
// ═══════════════════════════════════════════════════════════════════
async function handleWizardCallback(
  token: string,
  chatId: number,
  db: D1Database,
  parts: string[]
): Promise<void> {
  const action = parts[0];

  switch (action) {
    case 'skip':
      await handleWizardSkip(token, chatId, db, parts[1]);
      break;

    case 'cancel':
      await clearSession(db, chatId);
      await tgSend(token, chatId, '🏠 <b>تم الإلغاء.</b>', {
        reply_markup: mainMenuKeyboard(),
      });
      break;

    case 'confirm': {
      const confirmType = parts[1];
      if (confirmType === 'create') {
        const session = await getSession(db, chatId);
        await executeCreateMission(token, chatId, db, session.data);
      }
      break;
    }

    case 'restart': {
      const session = await getSession(db, chatId);
      await startCreateWizard(token, chatId, db, session.data);
      break;
    }
  }
}

// ─── Wizard Skip Handler ─────────────────────────────────────────
async function handleWizardSkip(
  token: string,
  chatId: number,
  db: D1Database,
  field: string
): Promise<void> {
  const session = await getSession(db, chatId);
  const data = { ...session.data };

  switch (field) {
    case 'description':
      data.description = null;
      await setSession(db, chatId, 'create_location', data);
      await tgSend(
        token,
        chatId,
        '✅ الوصف: <b>—</b>\n\n' +
        '📍 الخطوة 3 من 7: اكتب المقر أو العنوان\n\n' +
        '💡 مثال: مبنى إدارة الإسعاف — المنيا العامة — ديرمواس',
        { reply_markup: skipButtonKeyboard('location') }
      );
      break;

    case 'location':
      data.location = null;
      await setSession(db, chatId, 'create_start', data);
      await tgSend(
        token,
        chatId,
        '✅ المقر: <b>—</b>\n\n' +
        '📅 الخطوة 4 من 7: اكتب تاريخ ووقت البداية\n\n' +
        '💡 مثال: 2026-09-15 09:00 أو بعد غد الساعة 9',
        { reply_markup: skipButtonKeyboard('start_at') }
      );
      break;

    case 'start_at':
      data.start_at = null;
      await setSession(db, chatId, 'create_end', data);
      await tgSend(
        token,
        chatId,
        '✅ البداية: <b>سيتم تحديده تلقائياً</b>\n\n' +
        '📅 الخطوة 5 من 7: اكتب تاريخ ووقت النهاية\n\n' +
        '💡 مثال: 2026-09-22 17:00 أو بعد أسبوع الساعة 5',
        { reply_markup: skipButtonKeyboard('end_at') }
      );
      break;

    case 'end_at':
      data.end_at = null;
      await setSession(db, chatId, 'create_capacity', data);
      await tgSend(
        token,
        chatId,
        '✅ النهاية: <b>سيتم تحديده تلقائياً</b>\n\n' +
        '👥 الخطوة 6 من 7: كم متطوع مطلوب؟ (عدد صحيح أكبر من صفر)\n\n' +
        '💡 مثال: 20 أو 50',
        { reply_markup: skipButtonKeyboard('capacity') }
      );
      break;

    case 'capacity':
      data.capacity = 0;
      await setSession(db, chatId, 'create_waitlist', data);
      await tgSend(
        token,
        chatId,
        '✅ السعة: <b>بدون حد</b>\n\n' +
        '⏳ الخطوة 7 من 7: كم متطوع في قائمة الانتظار؟ (افتراضي 0)\n\n' +
        '💡 مثال: 5 أو 10\n' +
        '⏭️ يمكنك الضغط على "تخطي" لوحدك دون قائمة انتظار',
        { reply_markup: skipButtonKeyboard('waiting_list') }
      );
      break;

    case 'waiting_list':
      data.waiting_list = 0;
      await setSession(db, chatId, 'create_confirm', data);
      // Show confirmation summary
      const { formatCreateSummary } = await import('./formatters');
      const { createConfirmKeyboard } = await import('./keyboards');
      await tgSend(token, chatId, formatCreateSummary(data as any), {
        reply_markup: createConfirmKeyboard(),
      });
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════
// confirm:* — Confirmation Actions
// ═══════════════════════════════════════════════════════════════════
async function handleConfirm(
  token: string,
  chatId: number,
  db: D1Database,
  parts: string[]
): Promise<void> {
  const action = parts[0];
  const entityId = parts[1];

  switch (action) {
    case 'delete':
      if (entityId) await executeDelete(token, chatId, db, entityId);
      break;
    case 'cancelreg':
      if (entityId) await handleCancelRegConfirm(token, chatId, db, entityId);
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════
// edit:* — Edit Mission Field Selection
// ═══════════════════════════════════════════════════════════════════
async function handleEdit(
  token: string,
  chatId: number,
  db: D1Database,
  parts: string[]
): Promise<void> {
  // edit:field:<missionId>:<fieldname>
  const action = parts[0];
  if (action !== 'field') return;

  const missionId = parts[1];
  const fieldName = parts[2];

  if (!missionId || !fieldName || !EDIT_FIELD_LABELS[fieldName]) return;

  // Set wizard state to edit_value so the next text input is captured
  await setSession(db, chatId, 'edit_value', {
    missionId,
    editField: fieldName,
  });

  const fieldLabel = EDIT_FIELD_LABELS[fieldName];
  await tgSend(
    token,
    chatId,
    `✏️ <b>تعديل ${fieldLabel}</b>\n\nاكتب القيمة الجديدة:`,
    { reply_markup: cancelWizardInline(missionId) }
  );
}

// ═══════════════════════════════════════════════════════════════════
// delete:* — Delete Mission Picker
// ═══════════════════════════════════════════════════════════════════
async function handleDelete(
  token: string,
  chatId: number,
  db: D1Database,
  parts: string[]
): Promise<void> {
  // delete:pick:<missionId>
  const action = parts[0];
  const missionId = parts[1];

  if (action === 'pick' && missionId) {
    await handleDeletePick(token, chatId, db, missionId);
  }
}

// ═══════════════════════════════════════════════════════════════════
// cancelreg:* — Cancel Registration Picker
// ═══════════════════════════════════════════════════════════════════
async function handleCancelReg(
  token: string,
  chatId: number,
  db: D1Database,
  parts: string[]
): Promise<void> {
  const action = parts[0];

  switch (action) {
    case 'mission': {
      const missionId = parts[1];
      if (missionId) await handleCancelMissionPick(token, chatId, db, missionId);
      break;
    }
    case 'vol': {
      const regId = parts[1];
      if (regId) await handleCancelVolunteerSelect(token, chatId, db, regId);
      break;
    }
    case 'back':
      await startCancelWizard(token, chatId, db);
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════
// notify:* — Notification Settings
// ═══════════════════════════════════════════════════════════════════
async function handleNotify(
  token: string,
  chatId: number,
  db: D1Database,
  parts: string[]
): Promise<void> {
  const action = parts[0];
  const value = action === 'on' ? '1' : '0';

  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ('notifications_enabled', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`
    )
    .bind(value, value)
    .run();

  const label = action === 'on' ? '🟢 تشغيل' : '🔴 إيقاف';
  await tgSend(token, chatId, `🔔 تم ${label} الإشعارات.`, {
    reply_markup: mainMenuKeyboard(),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────
function cancelWizardInline(missionId: string) {
  return {
    inline_keyboard: [
      [{ text: '❌ إلغاء', callback_data: `m:detail:${missionId}` }],
    ],
  };
}
