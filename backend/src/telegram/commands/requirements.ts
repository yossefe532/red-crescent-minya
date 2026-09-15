/**
 * Telegram Bot — Mission Requirements & Questions Handlers
 * Full parity with web admin for requirements/questions management.
 * Uses ONLY the mission.requirements service — single source of truth.
 * Requirement model: volunteer declaration + admin verification.
 */
import { tgSend, setSession, clearSession, getSession, escapeHtml } from '../bot';
import {
  requirementListKeyboard,
  questionListKeyboard,
  requirementDetailKeyboard,
  questionDetailKeyboard,
  questionTypeKeyboard,
  requirementTypeKeyboard,
} from '../keyboards';
import {
  getMissionRequirements,
  getRequirementById,
  createRequirement,
  updateRequirement,
  deleteRequirement,
  getMissionQuestions,
  getQuestionById,
  createQuestion,
  updateQuestion,
  deleteQuestion,
} from '../../services/mission.requirements.service';

// ─── Type labels ──────────────────────────────────────────────
const REQ_TYPE_AR: Record<string, string> = {
  TEXT_REQUIREMENT: 'نص إعلان/شرط',
};
const Q_TYPE_AR: Record<string, string> = {
  TEXT: 'نص حر',
  SINGLE_CHOICE: 'اختيار واحد',
  MULTI_CHOICE: 'اختيار متعدد',
  NUMBER: 'رقمي',
};
const Q_TYPE_ICON: Record<string, string> = {
  TEXT: '📝', SINGLE_CHOICE: '🔘', MULTI_CHOICE: '☑️', NUMBER: '🔢',
};

function yesNo(v: number | boolean | null | undefined): string {
  return v ? 'نعم' : 'لا';
}

// ═══════════════════════════════════════════════════════════════
// List views
// ═══════════════════════════════════════════════════════════════
export async function handleRequirementsList(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string
): Promise<void> {
  const requirements = await getMissionRequirements(db, missionId);
  let msg = `📋 <b>متطلبات المهمة</b>\n━━━━━━━━━━━━━━━━━\n\n`;
  if (requirements.length === 0) {
    msg += 'لا توجد متطلبات مضافة بعد.\nيمكنك إضافة شروط/متطلبات يقر بها المتطوع عند التسجيل.';
  } else {
    requirements.forEach((r, idx) => {
      const icon = r.requires_acceptance ? '☑️' : '📄';
      msg += `${idx + 1}. ${icon} ${escapeHtml(r.text)}\n`;
      msg += `   ${REQ_TYPE_AR[r.type] || r.type} · موافقة: ${yesNo(r.requires_acceptance)}\n\n`;
    });
  }
  await tgSend(token, chatId, msg, {
    reply_markup: requirementListKeyboard(missionId, requirements as any),
  });
}

export async function handleQuestionsList(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string
): Promise<void> {
  const questions = await getMissionQuestions(db, missionId);
  let msg = `❓ <b>أسئلة المهمة</b>\n━━━━━━━━━━━━━━━━━\n\n`;
  if (questions.length === 0) {
    msg += 'لا توجد أسئلة مضافة بعد.\nيمكنك إضافة أسئلة يجيب عنها المتطوع عند التسجيل.';
  } else {
    questions.forEach((q, idx) => {
      const icon = Q_TYPE_ICON[q.question_type] || '📝';
      msg += `${idx + 1}. ${icon} ${escapeHtml(q.question_text)}\n`;
      const req = q.required ? 'إلزامي' : 'اختياري';
      msg += `   ${Q_TYPE_AR[q.question_type] || q.question_type} · ${req}\n\n`;
    });
  }
  await tgSend(token, chatId, msg, {
    reply_markup: questionListKeyboard(missionId, questions as any),
  });
}

// ═══════════════════════════════════════════════════════════════
// Detail views
// ═══════════════════════════════════════════════════════════════
export async function handleRequirementDetail(
  token: string,
  chatId: number,
  db: D1Database,
  requirementId: string
): Promise<void> {
  const req = await getRequirementById(db, requirementId);
  if (!req) {
    await tgSend(token, chatId, '❌ المتطلب غير موجود.');
    return;
  }
  const msg = `📋 <b>تفاصيل المتطلب</b>\n━━━━━━━━━━━━━━━━━\n\n`
    + `📄 <b>النص:</b> ${escapeHtml(req.text)}\n`
    + `🏷️ <b>النوع:</b> ${REQ_TYPE_AR[req.type] || req.type}\n`
    + `${req.requires_acceptance ? '☑️' : '📄'} <b>يتطلب موافقة:</b> ${yesNo(req.requires_acceptance)}\n`
    + `🔍 <b>تحقق تلقائي:</b> ${yesNo(req.auto_verify)}\n`
    + `📌 <b>الترتيب:</b> ${req.sort_order}`;
  await tgSend(token, chatId, msg, {
    reply_markup: requirementDetailKeyboard(requirementId, req.mission_id),
  });
}

export async function handleQuestionDetail(
  token: string,
  chatId: number,
  db: D1Database,
  questionId: string
): Promise<void> {
  const q = await getQuestionById(db, questionId);
  if (!q) {
    await tgSend(token, chatId, '❌ السؤال غير موجود.');
    return;
  }
  let msg = `❓ <b>تفاصيل السؤال</b>\n━━━━━━━━━━━━━━━━━\n\n`
    + `📝 <b>النص:</b> ${escapeHtml(q.question_text)}\n`
    + `${Q_TYPE_ICON[q.question_type] || ''} <b>النوع:</b> ${Q_TYPE_AR[q.question_type] || q.question_type}\n`
    + `⚠️ <b>إلزامي:</b> ${yesNo(q.required)}\n`
    + `📌 <b>الترتيب:</b> ${q.sort_order}`;
  // Show options for choice questions
  if (q.question_type === 'SINGLE_CHOICE' || q.question_type === 'MULTI_CHOICE') {
    try {
      const opts = JSON.parse(q.options || '[]');
      if (Array.isArray(opts) && opts.length > 0) {
        msg += `\n\n🔘 <b>الخيارات:</b>\n` + opts.map((o: string, i: number) => `   ${i + 1}. ${escapeHtml(String(o))}`).join('\n');
      }
    } catch { /* keep simple */ }
  }
  await tgSend(token, chatId, msg, {
    reply_markup: questionDetailKeyboard(questionId, q.mission_id),
  });
}

// ═══════════════════════════════════════════════════════════════
// req:* callback routing
// ═══════════════════════════════════════════════════════════════
export async function handleReqCallback(
  token: string,
  chatId: number,
  db: D1Database,
  action: string,
  parts: string[]
): Promise<void> {
  switch (action) {
    case 'add': {
      const missionId = parts[1];
      if (!missionId) return;
      // Let admin pick the type first, then enter text.
      await setSession(db, chatId, 'req_text', { mode: 'add', missionId, type: 'TEXT_REQUIREMENT' });
      await tgSend(
        token,
        chatId,
        'اختر نوع المتطلب، ثم اكتب نصه في نفس الرسالة التالية (أو اكتب النص الآن مع اختيار النوع):',
        { reply_markup: requirementTypeKeyboard(missionId) }
      );
      break;
    }

    case 'set_type': {
      const missionId = parts[1];
      const type = parts[2] || 'TEXT_REQUIREMENT';
      const session = await getSession(db, chatId);
      if (!missionId) return;
      await setSession(db, chatId, 'req_text', { ...session.data, mode: 'add', missionId, type });
      await tgSend(token, chatId, '✍️ <b>اكتب نص المتطلب الجديد:</b>');
      break;
    }

    case 'detail': {
      const reqId = parts[1];
      if (reqId) await handleRequirementDetail(token, chatId, db, reqId);
      break;
    }

    case 'edit': {
      const reqId = parts[1];
      if (!reqId) return;
      const req = await getRequirementById(db, reqId);
      if (!req) {
        await tgSend(token, chatId, '❌ المتطلب غير موجود.');
        return;
      }
      await setSession(db, chatId, 'req_text', {
        mode: 'edit',
        requirementId: reqId,
        missionId: req.mission_id,
        type: req.type,
      });
      await tgSend(token, chatId, '✍️ <b>اكتب النص الجديد للمتطلب:</b>');
      break;
    }

    case 'delete': {
      const reqId = parts[1];
      if (!reqId) return;
      const req = await getRequirementById(db, reqId);
      if (!req) {
        await tgSend(token, chatId, '❌ المتطلب غير موجود.');
        return;
      }
      await deleteRequirement(db, reqId);
      await tgSend(token, chatId, '🗑️ <b>تم حذف المتطلب.</b>');
      await handleRequirementsList(token, chatId, db, req.mission_id);
      break;
    }

    default:
      console.warn('Unknown req action:', action);
  }
}

// ═══════════════════════════════════════════════════════════════
// q:* callback routing
// ═══════════════════════════════════════════════════════════════
export async function handleQuestionCallback(
  token: string,
  chatId: number,
  db: D1Database,
  action: string,
  parts: string[]
): Promise<void> {
  switch (action) {
    case 'add': {
      const missionId = parts[1];
      if (!missionId) return;
      // Choose type first, then text.
      await setSession(db, chatId, 'q_type', { mode: 'add', missionId });
      await tgSend(token, chatId, '❓ <b>اختر نوع السؤال الجديد:</b>', {
        reply_markup: questionTypeKeyboard(missionId),
      });
      break;
    }

    case 'set_type': {
      const missionId = parts[1];
      const qType = parts[2] || 'TEXT';
      if (!missionId) return;
      const session = await getSession(db, chatId);
      await setSession(db, chatId, 'q_text', {
        ...session.data,
        missionId,
        qType,
      });
      await tgSend(token, chatId, '✍️ <b>اكتب نص السؤال:</b>');
      break;
    }

    case 'detail': {
      const qId = parts[1];
      if (qId) await handleQuestionDetail(token, chatId, db, qId);
      break;
    }

    case 'edit': {
      const qId = parts[1];
      if (!qId) return;
      const q = await getQuestionById(db, qId);
      if (!q) {
        await tgSend(token, chatId, '❌ السؤال غير موجود.');
        return;
      }
      await setSession(db, chatId, 'q_text', {
        mode: 'edit',
        questionId: qId,
        missionId: q.mission_id,
        qType: q.question_type,
      });
      await tgSend(token, chatId, '✍️ <b>اكتب نص السؤال الجديد:</b>');
      break;
    }

    case 'delete': {
      const qId = parts[1];
      if (!qId) return;
      const q = await getQuestionById(db, qId);
      if (!q) {
        await tgSend(token, chatId, '❌ السؤال غير موجود.');
        return;
      }
      await deleteQuestion(db, qId);
      await tgSend(token, chatId, '🗑️ <b>تم حذف السؤال.</b>');
      await handleQuestionsList(token, chatId, db, q.mission_id);
      break;
    }

    default:
      console.warn('Unknown q action:', action);
  }
}

// ═══════════════════════════════════════════════════════════════
// Wizard text handlers (req_text / q_text / q_options)
// ═══════════════════════════════════════════════════════════════
export async function handleRequirementText(
  token: string,
  chatId: number,
  db: D1Database,
  text: string
): Promise<void> {
  const session = await getSession(db, chatId);
  const data = session.data as any;
  const trimmed = text.trim();
  if (!trimmed) {
    await tgSend(token, chatId, '⚠️ نص المتطلب لا يمكن أن يكون فارغاً.');
    return;
  }

  try {
    if (data.mode === 'edit' && data.requirementId) {
      await updateRequirement(db, data.requirementId, { text: trimmed });
    } else if (data.missionId) {
      const existing = await getMissionRequirements(db, data.missionId);
      await createRequirement(
        db,
        data.missionId,
        data.type || 'TEXT_REQUIREMENT',
        trimmed,
        1, // requires_acceptance
        0, // auto_verify
        existing.length
      );
    } else {
      await tgSend(token, chatId, '❌ حدث خطأ (لا توجد مهمة).');
      return;
    }

    await clearSession(db, chatId);
    await tgSend(token, chatId, '✅ <b>تم حفظ المتطلب.</b>');
    if (data.missionId) await handleRequirementsList(token, chatId, db, data.missionId);
  } catch (err: any) {
    console.error('Save requirement failed:', err);
    await tgSend(token, chatId, `❌ فشل الحفظ: ${err.message}`);
  }
}

export async function handleQuestionText(
  token: string,
  chatId: number,
  db: D1Database,
  text: string
): Promise<void> {
  const session = await getSession(db, chatId);
  const data = session.data as any;
  const trimmed = text.trim();
  if (!trimmed) {
    await tgSend(token, chatId, '⚠️ نص السؤال لا يمكن أن يكون فارغاً.');
    return;
  }

  const qType = data.qType || 'TEXT';

  // Choice questions need options input before final save.
  if (qType === 'SINGLE_CHOICE' || qType === 'MULTI_CHOICE') {
    await setSession(db, chatId, 'q_options', { ...data, questionText: trimmed });
    await tgSend(
      token,
      chatId,
      '🔘 <b>اكتب الخيارات</b> مفصولة بفواصل (مثال: <code>خيار 1, خيار 2, خيار 3</code>)'
    );
    return;
  }

  try {
    if (data.mode === 'edit' && data.questionId) {
      await updateQuestion(db, data.questionId, { question_text: trimmed });
    } else if (data.missionId) {
      const existing = await getMissionQuestions(db, data.missionId);
      await createQuestion(db, data.missionId, trimmed, qType, 0, '[]', existing.length);
    } else {
      await tgSend(token, chatId, '❌ حدث خطأ (لا توجد مهمة).');
      return;
    }
    await clearSession(db, chatId);
    await tgSend(token, chatId, '✅ <b>تم حفظ السؤال.</b>');
    if (data.missionId) await handleQuestionsList(token, chatId, db, data.missionId);
  } catch (err: any) {
    console.error('Save question failed:', err);
    await tgSend(token, chatId, `❌ فشل الحفظ: ${err.message}`);
  }
}

export async function handleQuestionOptions(
  token: string,
  chatId: number,
  db: D1Database,
  text: string
): Promise<void> {
  const session = await getSession(db, chatId);
  const data = session.data as any;
  const trimmed = text.trim();
  const options = trimmed
    .split(/[,،\n]/)
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);

  try {
    const optionsJson = JSON.stringify(options);
    if (data.mode === 'edit' && data.questionId) {
      await updateQuestion(db, data.questionId, {
        question_text: data.questionText,
        question_type: data.qType,
        options: optionsJson,
      });
    } else if (data.missionId) {
      const existing = await getMissionQuestions(db, data.missionId);
      await createQuestion(
        db,
        data.missionId,
        data.questionText,
        data.qType,
        0,
        optionsJson,
        existing.length
      );
    } else {
      await tgSend(token, chatId, '❌ حدث خطأ (لا توجد مهمة).');
      return;
    }
    await clearSession(db, chatId);
    await tgSend(token, chatId, '✅ <b>تم حفظ السؤال.</b>');
    if (data.missionId) await handleQuestionsList(token, chatId, db, data.missionId);
  } catch (err: any) {
    console.error('Save question options failed:', err);
    await tgSend(token, chatId, `❌ فشل الحفظ: ${err.message}`);
  }
}