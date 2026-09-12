/**
 * Telegram Bot — Create Mission Wizard Handler
 * Multi-step mission creation via wizard.
 * Uses ONLY createMission service — single source of truth.
 */
import { WizardData } from '../types';
import { tgSend, getSession, setSession, clearSession } from '../bot';
import { formatCreateSummary, statusLabel } from '../formatters';
import {
  cancelWizardKeyboard, skipButtonKeyboard, createConfirmKeyboard,
  mainMenuKeyboard, missionDetailKeyboard,
} from '../keyboards';
import { createMission } from '../../services/mission.service';
import { logAudit } from '../../services/audit.service';

// ─── Start Create Wizard ───────────────────────────────────────
export async function startCreateWizard(
  token: string,
  chatId: number,
  db: D1Database,
  initialData: Partial<WizardData> = {}
): Promise<void> {
  await setSession(db, chatId, 'create_title', { ...initialData });
  const titleHint = initialData.title ? `\n(الاسم المستخرج: <b>${initialData.title}</b>)` : '';
  await tgSend(token, chatId,
    `➕ <b>إنشاء مهمة جديدة</b>\n\n` +
    `📍 الخطوة 1 من 7: اكتب اسم المهمة${titleHint}\n\n` +
    `💡 مثال: إسعاف حادث — حملة تطعيم — تطوير مقر`,
    { reply_markup: cancelWizardKeyboard() }
  );
}

// ─── Handle Title Input ────────────────────────────────────────
export async function handleCreateTitle(
  token: string,
  chatId: number,
  db: D1Database,
  title: string
): Promise<void> {
  if (!title || title.trim().length < 3) {
    await tgSend(token, chatId,
      '⚠️ اسم المهمة يجب أن يكون 3 أحرف على الأقل.\n' +
      '📍 اكتب اسم المهمة:',
      { reply_markup: cancelWizardKeyboard() }
    );
    return;
  }
  await setSession(db, chatId, 'create_description', { title: title.trim() });
  await tgSend(token, chatId,
    `✅ الاسم: <b>${title.trim()}</b>\n\n` +
    `📄 الخطوة 2 من 7: اكتب الوصف (اختياري)\n\n` +
    `💡 مثال: مهمة لإسعاف المصابين في الحوادث المرورية\n` +
    `⏭️ يمكنك الضغط على "تخطي" إذا أردت ترك الوصف فارغاً`,
    { reply_markup: skipButtonKeyboard('description') }
  );
}

// ─── Handle Description Input ──────────────────────────────────
export async function handleCreateDescription(
  token: string,
  chatId: number,
  db: D1Database,
  description: string
): Promise<void> {
  const session = await getSession(db, chatId);
  const data = { ...session.data, description: description.trim() || null };
  await setSession(db, chatId, 'create_location', data);
  await tgSend(token, chatId,
    `✅ الوصف: <b>${description.trim() || '—'}</b>\n\n` +
    `📍 الخطوة 3 من 7: اكتب المقر أو العنوان\n\n` +
    `💡 مثال: مبنى إدارة الإسعاف — المنيا العامة — ديرمواس`,
    { reply_markup: skipButtonKeyboard('location') }
  );
}

// ─── Handle Location Input ─────────────────────────────────────
export async function handleCreateLocation(
  token: string,
  chatId: number,
  db: D1Database,
  location: string
): Promise<void> {
  const session = await getSession(db, chatId);
  const data = { ...session.data, location: location.trim() || null };
  await setSession(db, chatId, 'create_start', data);
  await tgSend(token, chatId,
    `✅ المقر: <b>${location.trim() || '—'}</b>\n\n` +
    `📅 الخطوة 4 من 7: اكتب تاريخ ووقت البداية\n\n` +
    `💡 مثال: 2026-09-15 09:00 أو بعد غد الساعة 9`,
    { reply_markup: skipButtonKeyboard('start_at') }
  );
}

// ─── Handle Start Time Input ───────────────────────────────────
export async function handleCreateStart(
  token: string,
  chatId: number,
  db: D1Database,
  startAtText: string
): Promise<void> {
  // Try to parse the date - simple approach
  let startAt: string | null = null;
  try {
    const parsed = new Date(startAtText);
    if (!isNaN(parsed.getTime())) {
      startAt = parsed.toISOString();
    }
  } catch {
    // Keep as null, will use default in execution
  }

  const session = await getSession(db, chatId);
  const data = { ...session.data, start_at: startAt };
  await setSession(db, chatId, 'create_end', data);
  await tgSend(token, chatId,
    `✅ البداية: <b>${startAtText || 'سيتم تحديده تلقائياً (7 أيام من الآن)'}</b>\n\n` +
    `📅 الخطوة 5 من 7: اكتب تاريخ ووقت النهاية\n\n` +
    `💡 مثال: 2026-09-22 17:00 أو بعد أسبوع الساعة 5`,
    { reply_markup: skipButtonKeyboard('end_at') }
  );
}

// ─── Handle End Time Input ─────────────────────────────────────
export async function handleCreateEnd(
  token: string,
  chatId: number,
  db: D1Database,
  endAtText: string
): Promise<void> {
  let endAt: string | null = null;
  try {
    const parsed = new Date(endAtText);
    if (!isNaN(parsed.getTime())) {
      endAt = parsed.toISOString();
    }
  } catch {
    // Keep as null
  }

  const session = await getSession(db, chatId);
  const data = { ...session.data, end_at: endAt };
  await setSession(db, chatId, 'create_capacity', data);
  await tgSend(token, chatId,
    `✅ النهاية: <b>${endAtText || 'سيتم تحديده تلقائياً (بعد البداية بـ 12 ساعة)'}</b>\n\n` +
    `👥 الخطوة 6 من 7: كم متطوع مطلوب؟ (عدد صحيح أكبر من صفر)\n\n` +
    `💡 مثال: 20 أو 50`,
    { reply_markup: skipButtonKeyboard('capacity') }
  );
}

// ─── Handle Capacity Input ─────────────────────────────────────
export async function handleCreateCapacity(
  token: string,
  chatId: number,
  db: D1Database,
  capacityText: string
): Promise<void> {
  const capacity = parseInt(capacityText.trim(), 10);
  if (isNaN(capacity) || capacity < 1) {
    await tgSend(token, chatId,
      '⚠️ اكتب رقم صحيح للمتطوعين (مثلاً: 20).\n' +
      '👥 كم متطوع مطلوب؟',
      { reply_markup: skipButtonKeyboard('capacity') }
    );
    return;
  }

  const session = await getSession(db, chatId);
  const data = { ...session.data, capacity };
  await setSession(db, chatId, 'create_waitlist', data);
  await tgSend(token, chatId,
    `✅ السعة: <b>${capacity} متطوع</b>\n\n` +
    `⏳ الخطوة 7 من 7: كم متطوع في قائمة الانتظار؟ (افتراضي 0)\n\n` +
    `💡 مثال: 5 أو 10\n` +
    `⏭️ يمكنك الضغط على "تخطي" لتركها 0`,
    { reply_markup: skipButtonKeyboard('waiting_list') }
  );
}

// ─── Handle Waiting List Input ─────────────────────────────────
export async function handleCreateWaitingList(
  token: string,
  chatId: number,
  db: D1Database,
  waitingListText: string
): Promise<void> {
  const waitingList = parseInt(waitingListText.trim(), 10);
  const waitingListNum = isNaN(waitingList) || waitingList < 0 ? 0 : waitingList;

  const session = await getSession(db, chatId);
  const data = { ...session.data, waiting_list: waitingListNum };
  await setSession(db, chatId, 'create_confirm', data);

  // Show confirmation summary
  await showCreateSummary(token, chatId, db, data);
}

// ─── Show Create Summary ───────────────────────────────────────
export async function showCreateSummary(
  token: string,
  chatId: number,
  db: D1Database,
  data: WizardData
): Promise<void> {
  await tgSend(token, chatId, formatCreateSummary(data), {
    reply_markup: createConfirmKeyboard()
  });
}

// ─── Execute Create Mission ────────────────────────────────────
export async function executeCreateMission(
  token: string,
  chatId: number,
  db: D1Database,
  data: WizardData
): Promise<void> {
  // Prepare mission data for service
  const missionData: Record<string, unknown> = {
    title: data.title,
    description: data.description,
    location: data.location,
    start_at: data.start_at,
    end_at: data.end_at,
    capacity: data.capacity,
    waiting_list: data.waiting_list,
    telegram_notifications: 1, // Default enabled
  };

  // Remove undefined values
  Object.keys(missionData).forEach(key =>
    missionData[key] === undefined && delete missionData[key]
  );

  try {
    // Use the official service - SINGLE SOURCE OF TRUTH
    const mission = await createMission(db, missionData);

    // Log audit
    await logAudit(db, {
      actorId: 'telegram', // TODO: get actual admin ID from session
      actorType: 'admin',
      action: 'MISSION_CREATED',
      entityType: 'mission',
      entityId: mission.id,
      metadata: { title: mission.title, capacity: mission.capacity }
    });

    // Success message
    await tgSend(token, chatId,
      `✅ <b>تم إنشاء المهمة بنجاح!</b>\n\n` +
      `📝 <b>الاسم:</b> ${mission.title}\n` +
      `📍 <b>المقر:</b> ${mission.location || '—'}\n` +
      `👥 <b>العدد:</b> ${mission.capacity > 0 ? mission.capacity : 'بدون حد أقصى'}\n` +
      `🔗 <b>كود التسجيل:</b> ${mission.public_code}\n` +
      `📊 <b>الحالة:</b> ${statusLabel(mission.status)}\n\n` +
      `💡 افتح التسجيل من الأزرار بالأسفل 👇`,
      { reply_markup: missionDetailKeyboard(mission.id, mission.status) }
    );

    // Clear session
    await clearSession(db, chatId);
  } catch (error: any) {
    console.error('Create mission failed:', error);
    await tgSend(token, chatId,
      `❌ فشل إنشاء المهمة: ${error.message || 'خطأ غير متوقع'}\n\n` +
      `يرجى المحاولة مرة أخرى أو التواصل مع الدعم.`,
      { reply_markup: mainMenuKeyboard() }
    );
  }
}