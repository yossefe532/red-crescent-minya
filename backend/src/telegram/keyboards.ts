/**
 * Telegram Bot — Keyboard Builders
 * All InlineKeyboard definitions in one place.
 */
import { InlineKeyboard } from 'grammy';
import { escapeHtml } from './bot';

// ─── Main Menu ─────────────────────────────────────────────────
export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📋 المهمات', 'nav:missions')
    .text('🟢 النشطة', 'nav:missions:active')
    .row()
    .text('➕ مهمة جديدة', 'nav:create')
    .text('📊 إحصائيات', 'nav:stats')
    .row()
    .text('🔔 الإشعارات', 'nav:notifications')
    .text('❤️ حالة النظام', 'nav:health')
    .row()
    .text('❓ مساعدة', 'nav:help');
}

// ─── Mission List Item ─────────────────────────────────────────
export function missionListKeyboard(missionId: string, status: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text('📄 التفاصيل', `m:detail:${missionId}`);
  kb.text('👥 المتطوعين', `m:regs:${missionId}`);
  kb.row();
  if (status === 'OPEN') {
    kb.text('🔒 إغلاق', `m:close:${missionId}`);
  } else if (status === 'DRAFT' || status === 'CLOSED') {
    kb.text('🔓 فتح', `m:open:${missionId}`);
  }
  kb.text('🔗 رابط', `m:link:${missionId}`);
  return kb;
}

// ─── Mission Detail Actions ────────────────────────────────────
export function missionDetailKeyboard(missionId: string, status: string): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Status toggle
  if (status === 'OPEN') {
    kb.text('🔒 إغلاق التسجيل', `m:close:${missionId}`);
  } else if (status === 'DRAFT' || status === 'CLOSED') {
    kb.text('🔓 فتح التسجيل', `m:open:${missionId}`);
  }
  kb.row();

  // Registrant views
  kb.text('👥 المتطوعين', `m:regs:${missionId}`)
    .text('⏳ الانتظار', `m:wait:${missionId}`)
    .row();

  // Management
  kb.text('✏️ تعديل', `m:edit:${missionId}`)
    .text('📲 واتساب', `m:whatsapp:${missionId}`)
    .row();

  kb.text('🔗 رابط التسجيل', `m:link:${missionId}`)
    .text('📥 تصدير CSV', `m:export:${missionId}`)
    .row();

  kb.text('🗑️ حذف', `m:delete:${missionId}`)
    .text('🏠 الرئيسية', 'nav:home')
    .row();

  return kb;
}

// ─── Volunteer Actions ─────────────────────────────────────────
export function volunteerActionsKeyboard(
  regId: string,
  missionId: string,
  status: string,
  hasAudio: boolean
): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (hasAudio) {
    kb.text('🎙️ التسجيل الصوتي', `v:audio:${regId}`).row();
  }

  if (status === 'CONFIRMED') {
    kb.text('🔄 نقل للانتظار', `v:move:${regId}:WAITLIST`);
  } else if (status === 'WAITLIST') {
    kb.text('✅ تأكيد', `v:move:${regId}:CONFIRMED`);
  }

  if (status !== 'CANCELLED') {
    kb.text('❌ إلغاء التسجيل', `v:cancel:${regId}`);
  }
  kb.row();

  kb.text('👥 كل المسجلين', `m:regs:${missionId}`)
    .text('🏠 الرئيسية', 'nav:home');

  return kb;
}

// ─── Create Wizard ─────────────────────────────────────────────
export function skipButtonKeyboard(action: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('⏭️ تخطي', `wiz:skip:${action}`)
    .text('❌ إلغاء', 'wiz:cancel');
}

export function cancelWizardKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('❌ إلغاء', 'wiz:cancel');
}

export function createConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ إنشاء المهمة', 'wiz:confirm:create')
    .row()
    .text('✏️ تعديل', 'wiz:restart')
    .text('❌ إلغاء', 'wiz:cancel');
}

// ─── Confirmation Dialog ───────────────────────────────────────
export function confirmActionKeyboard(action: string, entityId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ تأكيد', `confirm:${action}:${entityId}`)
    .text('❌ إلغاء', 'nav:home');
}

// ─── Edit Mission Field Selection ──────────────────────────────
export function editFieldKeyboard(missionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('📝 الاسم', `edit:field:${missionId}:title`)
    .text('📄 الوصف', `edit:field:${missionId}:description`)
    .row()
    .text('📍 المقر', `edit:field:${missionId}:location`)
    .text('👥 السعة', `edit:field:${missionId}:capacity`)
    .row()
    .text('📅 البداية', `edit:field:${missionId}:start_at`)
    .text('📅 النهاية', `edit:field:${missionId}:end_at`)
    .row()
    .text('⏳ الانتظار', `edit:field:${missionId}:waiting_list`)
    .text('🔙 رجوع', `m:detail_pub:${missionId}`);
}

// ─── Notification Settings ─────────────────────────────────────
export function notificationSettingsKeyboard(isOn: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (isOn) {
    kb.text('🔴 إيقاف الإشعارات', 'notify:off');
  } else {
    kb.text('🟢 تشغيل الإشعارات', 'notify:on');
  }
  kb.row().text('🏠 الرئيسية', 'nav:home');
  return kb;
}

// ─── Back Buttons ──────────────────────────────────────────────
export function backToMissionKeyboard(missionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('📄 التفاصيل', `m:detail_pub:${missionId}`)
    .text('🏠 الرئيسية', 'nav:home');
}

export function backToHomeKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('🏠 الرئيسية', 'nav:home');
}

// ─── Mission Picker (for commands that need one) ─────────────
export function missionPickerKeyboard(
  missions: Array<{ id: string; public_code: string; title: string; status?: string }>,
  callbackPrefix: string
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const m of missions) {
    const statusIcon = m.status === 'OPEN' ? '🟢' : m.status === 'CLOSED' ? '🔴' : '📝';
    // Use m:detail_pub:<id> so the callback handler can look up by ID
    kb.text(`${statusIcon} ${m.public_code} — ${escapeHtml(m.title)}`, `m:detail_pub:${m.id}`).row();
  }
  kb.text('❌ إلغاء', 'nav:home');
  return kb;
}
