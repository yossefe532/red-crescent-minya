/**
 * Telegram Bot — Central Callback Dispatcher
 * Routes ALL callback_query actions to their handlers safely and reliably.
 */
import { tgSend, tgAnswerCb, clearSession, getSession, setSession } from './bot';
import { requireAdmin } from './auth';
import {
  mainMenuKeyboard,
  backToHomeKeyboard,
  editFieldKeyboard,
  notificationSettingsKeyboard,
  skipButtonKeyboard,
  createConfirmKeyboard,
  confirmActionKeyboard,
  missionDetailKeyboard,
  memberSearchKeyboard,
  memberSearchResultKeyboard,
  allVolunteersKeyboard,
  missionNotificationToggleKeyboard,
  activityFeedKeyboard,
} from './keyboards';
import { helpText, statusLabel, formatHealth, formatSearchResults, formatAllVolunteers, formatEnhancedStats, formatActivityFeed } from './formatters';
import { startCommandHandler, helpCommandHandler, cancelCommandHandler } from './commands/start';
import {
  handleListMissions,
  handleStats,
  handleHealth,
  handleMissionDetail,
  handleGetLink,
  handleWhatsAppMessage,
  handleExportCSV,
  handleMissionSelectForRegistrants,
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
import { handleCloseMission } from './commands/close';
import { handleReopenMission } from './commands/reopen';
import { getMissionById, getMissionByPublicCode } from '../services/mission.service';

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
export { executeSearch };

export async function handleCallbackQuery(
  token: string,
  chatId: number,
  db: D1Database,
  callbackQuery: any,
  adminChatIds: string = ''
): Promise<void> {
  const data: string | undefined = callbackQuery.data;
  if (!data) return;

  // Always answer callback query immediately to stop the client spinner
  try {
    await tgAnswerCb(token, callbackQuery.id);
  } catch (e) {
    console.warn('[handleCallbackQuery] tgAnswerCb failed:', e);
  }

  // Special case: no-op button
  if (data === 'noop') return;

  // Parse prefix:rest
  const colonIdx = data.indexOf(':');
  if (colonIdx === -1) return;

  const prefix = data.substring(0, colonIdx);
  const rest = data.substring(colonIdx + 1);
  const parts = rest.split(':');

  try {
    switch (prefix) {
      case 'nav':
        await handleNav(token, chatId, db, parts, adminChatIds);
        break;
      case 'm':
        await handleMission(token, chatId, db, parts, adminChatIds);
        break;
      case 'v':
        await handleVolunteer(token, chatId, db, parts, adminChatIds);
        break;
      case 'wiz':
        await handleWizardCallback(token, chatId, db, parts, adminChatIds);
        break;
      case 'confirm':
        await handleConfirm(token, chatId, db, parts, adminChatIds);
        break;
      case 'edit':
        await handleEdit(token, chatId, db, parts, adminChatIds);
        break;
      case 'delete':
        await handleDelete(token, chatId, db, parts, adminChatIds);
        break;
      case 'cancelreg':
        await handleCancelReg(token, chatId, db, parts, adminChatIds);
        break;
      case 'notify':
        await handleNotify(token, chatId, db, parts, adminChatIds);
        break;
      case 'search':
        await handleSearch(token, chatId, db, parts, adminChatIds);
        break;
      case 'vol':
        await handleVolunteers(token, chatId, db, parts, adminChatIds);
        break;
      case 'act':
        await handleActivity(token, chatId, db, parts, adminChatIds);
        break;
      default:
        console.warn('Unknown callback prefix:', prefix);
    }
  } catch (err: any) {
    console.error('[TG_CALLBACK] Error:', err);
    await tgSend(
      token,
      chatId,
      '❌ حدث خطأ غير متوقع أثناء معالجة الطلب. جرب /start',
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
  parts: string[],
  adminChatIds: string = ''
): Promise<void> {
  const action = parts[0];

  switch (action) {
    case 'home':
      await startCommandHandler(token, chatId, db, adminChatIds);
      break;

    case 'missions': {
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      const filter = parts[1] === 'active' ? 'OPEN' : 'ALL';
      await handleListMissions(token, chatId, db, 1, filter);
      break;
    }

    case 'create':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      await startCreateWizard(token, chatId, db);
      break;

    case 'registrants':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      await handleMissionSelectForRegistrants(token, chatId, db);
      break;

    case 'stats':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      await handleStats(token, chatId, db);
      break;

    case 'health':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      await handleHealth(token, chatId, db);
      break;

    case 'help':
      await helpCommandHandler(token, chatId, db, adminChatIds);
      break;

    case 'help_public':
      await helpCommandHandler(token, chatId, db, '');
      break;

    case 'cancel':
      await cancelCommandHandler(token, chatId, db, adminChatIds);
      break;

    case 'activity':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      await handleActivityFeed(token, chatId, db, 1);
      break;

    case 'search':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      await tgSend(token, chatId, '🔍 <b>البحث عن متطوع</b>\n\nاختر طريقة البحث:', {
        reply_markup: memberSearchKeyboard(),
      });
      break;

    case 'volunteers':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      await handleAllVolunteers(token, chatId, db, 1);
      break;

    case 'notifications': {
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      const row = await db
        .prepare("SELECT value FROM settings WHERE key = 'notifications_enabled'")
        .first<{ value: string }>();
      const isOn = row?.value === '1' || row?.value === 'true';

      // Count active missions with notifications enabled
      const missionNotifResult = await db
        .prepare("SELECT COUNT(*) as c FROM missions WHERE telegram_notifications = 1 AND status = 'OPEN'")
        .first<{ c: number }>();
      const activeMissionsWithNotif = missionNotifResult?.c ?? 0;

      const precedenceInfo = isOn
        ? `🟢 <b>الإشعارات العامة:</b> مفعّلة\n📋 <b>مهام مفعّلة للإشعارات:</b> ${activeMissionsWithNotif}\n\n💡 <b>ملاحظة:</b> عند التفعيل العام، ستصل إشعارات المهام المفعّلة. عند الإيقاف العام، لن تصل أي إشعارات.`
        : `🔴 <b>الإشعارات العامة:</b> متوقفة\n\n⚠️ لن تصل أي إشعارات حتى لو كانت مهام مفعّلة.`;

      await tgSend(
        token,
        chatId,
        `🔔 <b>إعدادات الإشعارات</b>\n\n━━━━━━━━━━━━━━━━━\n\n${precedenceInfo}`,
        { reply_markup: notificationSettingsKeyboard(isOn) }
      );
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
  parts: string[],
  adminChatIds: string = ''
): Promise<void> {
  const action = parts[0];
  const missionId = parts[1];

  switch (action) {
    case 'page':
    case 'list': {
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      const filter = parts[1] || 'ALL';
      const page = parseInt(parts[2] || '1', 10) || 1;
      await handleListMissions(token, chatId, db, page, filter);
      break;
    }

    case 'detail':
    case 'detail_pub':
      if (missionId) await handleMissionDetail(token, chatId, db, missionId);
      break;

    case 'regs':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (missionId) await handleRegistrants(token, chatId, db, missionId);
      break;

    case 'waitlist':
    case 'wait':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (missionId) await handleWaitlist(token, chatId, db, missionId);
      break;

    case 'close':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (missionId) await handleCloseMission(token, chatId, db, missionId, chatId);
      break;

    case 'open':
    case 'reopen':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (missionId) await handleReopenMission(token, chatId, db, missionId, chatId);
      break;

    case 'link':
      if (missionId) await handleGetLink(token, chatId, db, missionId);
      break;

    case 'whatsapp':
      if (missionId) await handleWhatsAppMessage(token, chatId, db, missionId);
      break;

    case 'edit':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (missionId) {
        await tgSend(
          token,
          chatId,
          '✏️ <b>اختر الحقل المراد تعديله في المهمة:</b>',
          { reply_markup: editFieldKeyboard(missionId) }
        );
      }
      break;

    case 'export':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (missionId) await handleExportCSV(token, chatId, db, missionId);
      break;

    case 'delete':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (missionId) await startDeleteWizard(token, chatId, db, missionId);
      break;

    case 'delete_pick':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (missionId) await executeDelete(token, chatId, db, missionId);
      break;

    case 'notify_toggle':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (missionId) await handleMissionNotificationToggle(token, chatId, db, missionId);
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════
// v:* — Volunteer Actions
// ═══════════════════════════════════════════════════════════════════
async function handleVolunteer(
  token: string,
  chatId: number,
  db: D1Database,
  parts: string[],
  adminChatIds: string = ''
): Promise<void> {
  const action = parts[0];
  const regId = parts[1];

  switch (action) {
    case 'detail':
      if (regId) await handleVolunteerDetail(token, chatId, db, regId);
      break;

    case 'audio':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (regId) await handleVolunteerAudio(token, chatId, db, regId);
      break;

    case 'promote':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (regId) await handleVolunteerMove(token, chatId, db, regId, 'CONFIRMED');
      break;

    case 'demote':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (regId) await handleVolunteerMove(token, chatId, db, regId, 'WAITLIST');
      break;

    case 'move': {
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      const targetStatus = parts[2] as 'CONFIRMED' | 'WAITLIST';
      if (regId && targetStatus) {
        await handleVolunteerMove(token, chatId, db, regId, targetStatus);
      }
      break;
    }

    case 'cancel':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (regId) {
        await tgSend(
          token,
          chatId,
          '⚠️ <b>هل أنت متأكد من إلغاء تسجيل هذا المتطوع؟</b>\nسيتم تحرير المقعد وترقية أول متطوع في قائمة الانتظار تلقائياً.',
          { reply_markup: confirmActionKeyboard('cancel', regId) }
        );
      }
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════
// wiz:* — Wizard Callback Actions
// ═══════════════════════════════════════════════════════════════════
async function handleWizardCallback(
  token: string,
  chatId: number,
  db: D1Database,
  parts: string[],
  adminChatIds: string = ''
): Promise<void> {
  const action = parts[0];

  switch (action) {
    case 'create': {
      const subAction = parts[1];
      if (subAction === 'skip') {
        await handleWizardSkip(token, chatId, db, parts[2]);
      } else if (subAction === 'confirm') {
        if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
        const session = await getSession(db, chatId);
        await executeCreateMission(token, chatId, db, session.data);
      } else if (subAction === 'cancel') {
        await clearSession(db, chatId);
        await tgSend(token, chatId, '🏠 <b>تم إلغاء إنشاء المهمة والعودة للرئيسية.</b>', {
          reply_markup: mainMenuKeyboard(),
        });
      }
      break;
    }

    case 'skip':
      await handleWizardSkip(token, chatId, db, parts[1]);
      break;

    case 'cancel':
      await clearSession(db, chatId);
      await tgSend(token, chatId, '🏠 <b>تم الإلغاء والعودة للرئيسية.</b>', {
        reply_markup: mainMenuKeyboard(),
      });
      break;

    case 'confirm': {
      const confirmType = parts[1];
      if (confirmType === 'create') {
        if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
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
        '✅ السعة: <b>بدون حد أقصى</b>\n\n' +
        '⏳ الخطوة 7 من 7: كم متطوع في قائمة الانتظار؟ (افتراضي 0)\n\n' +
        '💡 مثال: 5 أو 10\n' +
        '⏭️ يمكنك الضغط على "تخطي" لتركها بدون قائمة انتظار',
        { reply_markup: skipButtonKeyboard('waiting_list') }
      );
      break;

    case 'waiting_list':
      data.waiting_list = 0;
      await setSession(db, chatId, 'create_confirm', data);
      const { formatCreateSummary } = await import('./formatters');
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
  parts: string[],
  adminChatIds: string = ''
): Promise<void> {
  const action = parts[0];
  const entityId = parts[1];

  switch (action) {
    case 'delete':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (entityId) await executeDelete(token, chatId, db, entityId);
      break;
    case 'cancel':
    case 'cancelreg':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (entityId) await handleCancelRegConfirm(token, chatId, db, entityId);
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════
// edit:* — Edit Mission Field
// ═══════════════════════════════════════════════════════════════════
async function handleEdit(
  token: string,
  chatId: number,
  db: D1Database,
  parts: string[],
  adminChatIds: string = ''
): Promise<void> {
  // Supports both edit:field:<fieldname>:<missionId> and edit:field:<missionId>:<fieldname>
  const action = parts[0];
  if (action !== 'field') return;

  if (!await requireAdmin(token, chatId, db, adminChatIds)) return;

  let fieldName = parts[1];
  let missionId = parts[2];

  if (!EDIT_FIELD_LABELS[fieldName] && EDIT_FIELD_LABELS[parts[2]]) {
    fieldName = parts[2];
    missionId = parts[1];
  }

  if (!missionId || !fieldName || !EDIT_FIELD_LABELS[fieldName]) return;

  await setSession(db, chatId, 'edit_value', {
    missionId,
    editField: fieldName,
  });

  const fieldLabel = EDIT_FIELD_LABELS[fieldName];
  await tgSend(
    token,
    chatId,
    `✏️ <b>تعديل ${fieldLabel}</b>\n\nاكتب القيمة الجديدة الآن:`,
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
  parts: string[],
  adminChatIds: string = ''
): Promise<void> {
  const action = parts[0];
  const missionId = parts[1];

  if (action === 'pick' && missionId) {
    if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
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
  parts: string[],
  adminChatIds: string = ''
): Promise<void> {
  const action = parts[0];

  switch (action) {
    case 'mission':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (parts[1]) await handleCancelMissionPick(token, chatId, db, parts[1]);
      break;
    case 'vol':
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      if (parts[1]) await handleCancelVolunteerSelect(token, chatId, db, parts[1]);
      break;
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
  parts: string[],
  adminChatIds: string = ''
): Promise<void> {
  const action = parts[0];
  const subAction = parts[1];

  if (!await requireAdmin(token, chatId, db, adminChatIds)) return;

  const toggleOn = action === 'on' || subAction === 'on';
  const value = toggleOn ? '1' : '0';

  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ('notifications_enabled', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`
    )
    .bind(value, value)
    .run();

  const label = toggleOn ? '🟢 تشغيل' : '🔴 إيقاف';
  await tgSend(token, chatId, `🔔 تم ${label} إشعارات التليجرام بنجاح.`, {
    reply_markup: mainMenuKeyboard(),
  });
}

// ═══════════════════════════════════════════════════════════════════
// m:notify_toggle — Toggle notification for a specific mission
// ═══════════════════════════════════════════════════════════════════
async function handleMissionNotificationToggle(
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

  const currentValue = mission.telegram_notifications || 0;
  const newValue = currentValue === 1 ? 0 : 1;

  await db.prepare(
    `UPDATE missions SET telegram_notifications = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(newValue, missionId).run();

  const label = newValue === 1 ? '🟢 تشغيل' : '🔴 إيقاف';
  const updatedMission = await getMissionById(db, missionId);
  await tgSend(
    token,
    chatId,
    `🔔 تم ${label} إشعارات المهمة <b>${mission.title}</b> (${mission.public_code})`,
    { reply_markup: missionNotificationToggleKeyboard(missionId, newValue === 1) }
  );
}

// ═══════════════════════════════════════════════════════════════════
// nav:volunteers — All volunteers across all missions
// ═══════════════════════════════════════════════════════════════════
async function handleAllVolunteers(
  token: string,
  chatId: number,
  db: D1Database,
  page: number,
  statusFilter: string = 'ALL'
): Promise<void> {
  const perPage = 10;
  const offset = (page - 1) * perPage;

  // Build dynamic WHERE clause based on filter
  let whereClause = '';
  let bindParams: any[] = [];
  if (statusFilter === 'CONFIRMED') {
    whereClause = "WHERE r.status = 'CONFIRMED'";
  } else if (statusFilter === 'WAITLIST') {
    whereClause = "WHERE r.status = 'WAITLIST'";
  } else if (statusFilter === 'REJECTED') {
    whereClause = "WHERE r.status = 'REJECTED'";
  } else {
    // ALL — exclude only CANCELLED
    whereClause = "WHERE r.status != 'CANCELLED'";
  }

  const countResult = await db.prepare(
    `SELECT COUNT(*) as total FROM registrations r ${whereClause}`
  ).first<{ total: number }>();
  const total = countResult?.total || 0;
  const totalPages = Math.ceil(total / perPage);

  const result = await db.prepare(
    `SELECT r.id as regId, v.name, v.member_id, m.public_code as mission_code, r.status, r.created_at
     FROM registrations r
     JOIN volunteers v ON v.id = r.volunteer_id
     JOIN missions m ON r.mission_id = m.id
     ${whereClause}
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(perPage, offset).all();

  const volunteers = (result.results || []) as any[];

  await tgSend(
    token,
    chatId,
    formatAllVolunteers(volunteers, total, page, perPage),
    { reply_markup: allVolunteersKeyboard(volunteers, page, totalPages, statusFilter) }
  );
}

// ═══════════════════════════════════════════════════════════════════
// search:* — Member Search
// ═══════════════════════════════════════════════════════════════════
async function handleSearch(
  token: string,
  chatId: number,
  db: D1Database,
  parts: string[],
  adminChatIds: string = ''
): Promise<void> {
  const action = parts[0];

  switch (action) {
    case 'prompt': {
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      const searchType = parts[1]; // 'member_id' or 'name'
      const label = searchType === 'member_id' ? 'رقم العضوية' : 'الاسم';
      await setSession(db, chatId, 'search_input', { searchType });
      await tgSend(
        token,
        chatId,
        `🔍 <b>اكتب ${label} للبحث:</b>

💡 يمكنك كتابة الجزء الأول من الاسم أو رقم العضوية`,
        { reply_markup: backToHomeKeyboard() }
      );
      break;
    }

    case 'page': {
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      const session = await getSession(db, chatId);
      if (session.state === 'search_results' && session.data?.query) {
        const page = parseInt(parts[1] || '1', 10) || 1;
        await executeSearch(token, chatId, db, session.data.query as string, session.data.searchType as string, page);
      }
      break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// vol:* — Volunteers List Actions
// ═══════════════════════════════════════════════════════════════════
async function handleVolunteers(
  token: string,
  chatId: number,
  db: D1Database,
  parts: string[],
  adminChatIds: string = ''
): Promise<void> {
  const action = parts[0];

  switch (action) {
    case 'page': {
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      const page = parseInt(parts[1] || '1', 10) || 1;
      const statusFilter = parts[2] || 'ALL';
      await handleAllVolunteers(token, chatId, db, page, statusFilter);
      break;
    }
    case 'filter': {
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      const statusFilter = parts[1] || 'ALL';
      await handleAllVolunteers(token, chatId, db, 1, statusFilter);
      break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// act:* — Activity Feed Actions
// ═══════════════════════════════════════════════════════════════════
async function handleActivity(
  token: string,
  chatId: number,
  db: D1Database,
  parts: string[],
  adminChatIds: string = ''
): Promise<void> {
  const action = parts[0];

  switch (action) {
    case 'page': {
      if (!await requireAdmin(token, chatId, db, adminChatIds)) return;
      const page = parseInt(parts[1] || '1', 10) || 1;
      await handleActivityFeed(token, chatId, db, page);
      break;
    }
  }
}

async function handleActivityFeed(
  token: string,
  chatId: number,
  db: D1Database,
  page: number
): Promise<void> {
  const perPage = 15;
  const offset = (page - 1) * perPage;

  const countResult = await db.prepare(
    `SELECT COUNT(*) as total FROM audit_logs`
  ).first<{ total: number }>();
  const total = countResult?.total || 0;
  const totalPages = Math.ceil(total / perPage);

  const result = await db.prepare(
    `SELECT id, action, entity_type, entity_id, metadata, created_at
     FROM audit_logs
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(perPage, offset).all();

  const events = (result.results || []) as any[];

  await tgSend(
    token,
    chatId,
    formatActivityFeed(events, total, page, perPage),
    { reply_markup: activityFeedKeyboard(events, page, totalPages) }
  );
}

// ─── Search Execution ────────────────────────────────────────────
async function executeSearch(
  token: string,
  chatId: number,
  db: D1Database,
  query: string,
  searchType: string,
  page: number = 1
): Promise<void> {
  const perPage = 10;
  const offset = (page - 1) * perPage;
  const searchTerm = `%${query}%`;

  let whereClause: string;
  if (searchType === 'member_id') {
    whereClause = `v.member_id LIKE ?`;
  } else {
    whereClause = `v.name LIKE ?`;
  }

  const countResult = await db.prepare(
    `SELECT COUNT(*) as total FROM registrations r
     JOIN volunteers v ON v.id = r.volunteer_id
     WHERE ${whereClause}`
  ).bind(searchTerm).first<{ total: number }>();
  const total = countResult?.total || 0;
  const totalPages = Math.ceil(total / perPage);

  const result = await db.prepare(
    `SELECT r.id as regId, v.name, v.member_id, m.public_code as mission_code, r.status, r.seat_number, r.waitlist_position
     FROM registrations r
     JOIN volunteers v ON v.id = r.volunteer_id
     JOIN missions m ON r.mission_id = m.id
     WHERE ${whereClause}
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(searchTerm, perPage, offset).all();

  const results = (result.results || []) as any[];

  await setSession(db, chatId, 'search_results', { query, searchType, page });
  await tgSend(
    token,
    chatId,
    formatSearchResults(query, results, total),
    { reply_markup: memberSearchResultKeyboard(results, page, totalPages) }
  );
}

// ═══════════════════════════════════════════════════════════════════
// Wizard Search Input Handler
// ═══════════════════════════════════════════════════════════════════
// This is called from the main message handler when session.state === 'search_input'

// ─── Helpers ──────────────────────────────────────────────────────
function cancelWizardInline(missionId: string) {
  return {
    inline_keyboard: [
      [{ text: '❌ إلغاء والرجوع للتفاصيل', callback_data: `m:detail:${missionId}` }],
    ],
  };
}
