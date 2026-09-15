/**
 * Telegram Bot — Keyboard Builders
 * All InlineKeyboard definitions in one place.
 */
import { InlineKeyboard } from 'grammy';
import { escapeHtml } from './bot';

// ─── Main Menu ─────────────────────────────────────────────────
export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📋 المهام', 'nav:missions')
    .text('➕ إنشاء مهمة', 'nav:create')
    .row()
    .text('👥 المتطوعون', 'nav:volunteers')
    .text('🔍 البحث', 'nav:search')
    .row()
    .text('📊 الإحصائيات', 'nav:stats')
    .text('🏥 فحص النظام', 'nav:health')
    .row()
    .text('❓ المساعدة', 'nav:help');
}

// ─── Public User Menu ──────────────────────────────────────────
export function publicUserKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .url('🌐 بوابة التسجيل في المهام', 'https://red-crescent-minya.pages.dev')
    .row()
    .text('❓ معلومات ومساعدة', 'nav:help_public');
}

// ─── Mission List Keyboard ─────────────────────────────────────
export function missionListKeyboard(
  missions: Array<{ id: string; public_code: string; title: string; status?: string }>,
  page: number,
  totalPages: number,
  filter: string
): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Filter tabs
  const allTag = filter === 'ALL' ? '• الكل •' : 'الكل';
  const openTag = filter === 'OPEN' ? '• المفتوحة 🟢 •' : 'المفتوحة 🟢';
  const closedTag = filter === 'CLOSED' ? '• المغلقة 🔴 •' : 'المغلقة 🔴';

  kb.text(allTag, 'm:page:ALL:1')
    .text(openTag, 'm:page:OPEN:1')
    .text(closedTag, 'm:page:CLOSED:1')
    .row();

  // Missions buttons
  for (const m of missions) {
    const statusIcon = m.status === 'OPEN' ? '🟢' : m.status === 'CLOSED' ? '🔴' : '📝';
    kb.text(`${statusIcon} ${m.public_code} — ${escapeHtml(m.title)}`, `m:detail:${m.id}`).row();
  }

  // Pagination
  if (totalPages > 1) {
    if (page > 1) {
      kb.text('◀️ السابق', `m:page:${filter}:${page - 1}`);
    }
    kb.text(`${page} / ${totalPages}`, 'noop');
    if (page < totalPages) {
      kb.text('التالي ▶️', `m:page:${filter}:${page + 1}`);
    }
    kb.row();
  }

  kb.text('➕ إنشاء مهمة جديدة', 'nav:create')
    .text('🏠 الرئيسية', 'nav:home');

  return kb;
}

// ─── Mission Detail Actions ────────────────────────────────────
export function missionDetailKeyboard(missionId: string, status: string): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Status toggle — strictly valid actions only
  if (status === 'OPEN') {
    kb.text('🔒 إغلاق المهمة', `m:close:${missionId}`);
  } else if (status === 'CLOSED') {
    kb.text('🔓 إعادة فتح المهمة', `m:reopen:${missionId}`);
  } else if (status === 'DRAFT') {
    kb.text('🟢 فتح التسجيل', `m:reopen:${missionId}`);
  }
  kb.row();

  // Registrant views
  kb.text('👥 المتطوعون', `m:regs:${missionId}`)
    .text('⏳ الانتظار', `m:waitlist:${missionId}`)
    .row();

  // Management & links
  kb.text('✏️ تعديل', `m:edit:${missionId}`)
    .text('🔗 رابط التسجيل', `m:link:${missionId}`)
    .row();

  kb.text('📲 واتساب', `m:whatsapp:${missionId}`)
    .text('📥 تصدير CSV', `m:export:${missionId}`)
    .row();

  // Requirements & Questions management
  kb.text('📋 المتطلبات', `m:reqs:${missionId}`)
    .text('❓ الأسئلة', `m:questions:${missionId}`)
    .row();

  kb.text('🗑️ حذف المهمة', `m:delete:${missionId}`)
    .text('🔔 الإشعارات', `m:notify_toggle:${missionId}`)
    .row();

  kb.text('⬅️ قائمة المهام', 'nav:missions')
    .text('🏠 الرئيسية', 'nav:home');

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
    kb.text('🎙️ تشغيل التسجيل', `v:audio:${regId}`).row();
  }

  if (status === 'CONFIRMED') {
    kb.text('⏳ نقل لقائمة الانتظار', `v:demote:${regId}`);
  } else if (status === 'WAITLIST') {
    kb.text('✅ ترقية لمقعد مؤكد', `v:promote:${regId}`);
  }

  if (status !== 'CANCELLED') {
    kb.text('❌ إلغاء التسجيل', `v:cancel:${regId}`);
  }
  kb.row();

  kb.text('👥 قائمة المتطوعين', `m:regs:${missionId}`)
    .text('📄 تفاصيل المهمة', `m:detail:${missionId}`)
    .row();

  kb.text('🏠 الرئيسية', 'nav:home');

  return kb;
}

// ─── Create Wizard ─────────────────────────────────────────────
export function skipButtonKeyboard(action: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('⏭️ تخطي', `wiz:create:skip:${action}`)
    .text('❌ إلغاء', 'wiz:create:cancel');
}

export function cancelWizardKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('❌ إلغاء', 'wiz:create:cancel');
}

export function createConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ إنشاء المهمة', 'wiz:create:confirm')
    .row()
    .text('❌ إلغاء', 'wiz:create:cancel');
}

// ─── Confirmation Dialog ───────────────────────────────────────
export function confirmActionKeyboard(action: string, entityId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ تأكيد التنفيذ', `confirm:${action}:${entityId}`)
    .text('❌ إلغاء', 'nav:home');
}

// ─── Edit Mission Field Selection ──────────────────────────────
export function editFieldKeyboard(missionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('📝 الاسم', `edit:field:title:${missionId}`)
    .text('📄 الوصف', `edit:field:description:${missionId}`)
    .row()
    .text('📍 المقر', `edit:field:location:${missionId}`)
    .text('👥 السعة', `edit:field:capacity:${missionId}`)
    .row()
    .text('📅 البداية', `edit:field:start_at:${missionId}`)
    .text('📅 النهاية', `edit:field:end_at:${missionId}`)
    .row()
    .text('⏳ الانتظار', `edit:field:waiting_list:${missionId}`)
    .text('🔙 رجوع للتفاصيل', `m:detail:${missionId}`);
}

// ─── Notification Settings ─────────────────────────────────────
export function notificationSettingsKeyboard(isOn: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (isOn) {
    kb.text('🔴 إيقاف الإشعارات', 'notify:toggle:off');
  } else {
    kb.text('🟢 تشغيل الإشعارات', 'notify:toggle:on');
  }
  kb.row().text('🏠 الرئيسية', 'nav:home');
  return kb;
}

// ─── Back Buttons ──────────────────────────────────────────────
export function backToMissionKeyboard(missionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('📄 تفاصيل المهمة', `m:detail:${missionId}`)
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
    kb.text(`${statusIcon} ${m.public_code} — ${escapeHtml(m.title)}`, `${callbackPrefix}:${m.id}`).row();
  }
  kb.text('❌ إلغاء', 'nav:home');
  return kb;
}

// ─── Member Search ────────────────────────────────────────────
export function memberSearchKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔢 بحث برقم العضوية', 'search:prompt:member_id')
    .text('📝 بحث بالاسم', 'search:prompt:name')
    .row()
    .text('🏠 الرئيسية', 'nav:home');
}

export function memberSearchResultKeyboard(
  results: Array<{ regId: string; name: string; memberId: string; missionCode: string; status: string }>,
  page: number,
  totalPages: number
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const r of results) {
    const statusIcon = r.status === 'CONFIRMED' ? '✅' : r.status === 'WAITLIST' ? '⏳' : '❌';
    kb.text(`${statusIcon} ${r.name} (${r.memberId}) — ${r.missionCode}`, `v:detail:${r.regId}`).row();
  }
  if (totalPages > 1) {
    if (page > 1) kb.text('◀️ السابق', `search:page:${page - 1}`);
    kb.text(`${page} / ${totalPages}`, 'noop');
    if (page < totalPages) kb.text('التالي ▶️', `search:page:${page + 1}`);
    kb.row();
  }
  kb.text('🔍 بحث جديد', 'nav:search')
    .text('🏠 الرئيسية', 'nav:home');
  return kb;
}

// ─── All Volunteers List ──────────────────────────────────────
export function allVolunteersKeyboard(
  volunteers: Array<{ regId: string; name: string; memberId: string; missionCode: string; status: string }>,
  page: number,
  totalPages: number,
  statusFilter: string = 'ALL'
): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Status filter tabs
  const allTag = statusFilter === 'ALL' ? '• الكل •' : 'الكل';
  const confirmedTag = statusFilter === 'CONFIRMED' ? '• ✅ مؤكد •' : '✅ مؤكد';
  const waitlistTag = statusFilter === 'WAITLIST' ? '• ⏳ انتظار •' : '⏳ انتظار';
  const rejectedTag = statusFilter === 'REJECTED' ? '• 🚫 مرفوض •' : '🚫 مرفوض';
  kb.text(allTag, 'vol:filter:ALL')
    .text(confirmedTag, 'vol:filter:CONFIRMED')
    .row()
    .text(waitlistTag, 'vol:filter:WAITLIST')
    .text(rejectedTag, 'vol:filter:REJECTED')
    .row();

  for (const v of volunteers) {
    const statusIcon = v.status === 'CONFIRMED' ? '✅' : v.status === 'WAITLIST' ? '⏳' : v.status === 'REJECTED' ? '🚫' : '❌';
    kb.text(`${statusIcon} ${v.name} (${v.memberId})`, `v:detail:${v.regId}`).row();
  }
  if (totalPages > 1) {
    if (page > 1) kb.text('◀️ السابق', `vol:page:${page - 1}:${statusFilter}`);
    kb.text(`${page} / ${totalPages}`, 'noop');
    if (page < totalPages) kb.text('التالي ▶️', `vol:page:${page + 1}:${statusFilter}`);
    kb.row();
  }
  kb.text('🏠 الرئيسية', 'nav:home');
  return kb;
}


// ─── Activity Feed ──────────────────────────────────────────
export function activityFeedKeyboard(
  events: Array<{ id: string; action: string; entityType: string }>,
  page: number,
  totalPages: number
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (totalPages > 1) {
    if (page > 1) kb.text('◀️ السابق', `act:page:${page - 1}`);
    kb.text(`${page} / ${totalPages}`, 'noop');
    if (page < totalPages) kb.text('التالي ▶️', `act:page:${page + 1}`);
    kb.row();
  }
  kb.text('🔄 تحديث', 'nav:activity')
    .text('🏠 الرئيسية', 'nav:home');
  return kb;
}

// ─── Mission Notification Toggle ──────────────────────────────
export function missionNotificationToggleKeyboard(missionId: string, isOn: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (isOn) {
    kb.text('🔴 إيقاف إشعارات هذه المهمة', `m:notify_toggle:${missionId}`);
  } else {
    kb.text('🟢 تشغيل إشعارات هذه المهمة', `m:notify_toggle:${missionId}`);
  }
  kb.row()
    .text('📄 تفاصيل المهمة', `m:detail:${missionId}`)
    .text('🏠 الرئيسية', 'nav:home');
  return kb;
}

// ─── Requirement Management ─────────────────────────────────
export function requirementListKeyboard(
  missionId: string,
  requirements: Array<{ id: string; text: string; type: string; requires_acceptance: number }>
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const req of requirements) {
    const icon = req.requires_acceptance ? '☑️' : '📄';
    kb.text(`${icon} ${escapeHtml(req.text)}`, `req:detail:${req.id}`).row();
  }
  kb.text('➕ إضافة متطلب جديد', `req:add:${missionId}`).row();
  kb.text('📄 تفاصيل المهمة', `m:detail:${missionId}`);
  return kb;
}

export function requirementDetailKeyboard(requirementId: string, missionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✏️ تعديل النص', `req:edit:${requirementId}`)
    .row()
    .text('🗑️ حذف', `req:delete:${requirementId}`)
    .row()
    .text('📋 قائمة المتطلبات', `m:reqs:${missionId}`)
    .text('📄 تفاصيل المهمة', `m:detail:${missionId}`);
}

export function requirementTypeKeyboard(missionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('☑️ موافقة (_stub)', `req:set_type:${missionId}:STUB`)
    .row()
    .text('❌ إلغاء', `m:reqs:${missionId}`);
}

// ─── Question Management ────────────────────────────────────
export function questionListKeyboard(
  missionId: string,
  questions: Array<{ id: string; question_text: string; question_type: string }>
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const q of questions) {
    const icon = q.question_type === 'TEXT' ? '📝' : q.question_type === 'SINGLE_CHOICE' ? '🔘' : q.question_type === 'MULTI_CHOICE' ? '☑️' : '🔢';
    kb.text(`${icon} ${escapeHtml(q.question_text)}`, `q:detail:${q.id}`).row();
  }
  kb.text('➕ إضافة سؤال جديد', `q:add:${missionId}`).row();
  kb.text('📄 تفاصيل المهمة', `m:detail:${missionId}`);
  return kb;
}

export function questionDetailKeyboard(questionId: string, missionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✏️ تعديل النص', `q:edit:${questionId}`)
    .row()
    .text('🗑️ حذف', `q:delete:${questionId}`)
    .row()
    .text('❓ قائمة الأسئلة', `m:questions:${missionId}`)
    .text('📄 تفاصيل المهمة', `m:detail:${missionId}`);
}

export function questionTypeKeyboard(missionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('📝 نص حر (TEXT)', `q:set_type:${missionId}:TEXT`)
    .row()
    .text('🔘 اختيار واحد (SINGLE_CHOICE)', `q:set_type:${missionId}:SINGLE_CHOICE`)
    .row()
    .text('☑️ اختيار متعدد (MULTI_CHOICE)', `q:set_type:${missionId}:MULTI_CHOICE`)
    .row()
    .text('🔢 رقمي (NUMBER)', `q:set_type:${missionId}:NUMBER`)
    .row()
    .text('❌ إلغاء', `m:questions:${missionId}`);
}
