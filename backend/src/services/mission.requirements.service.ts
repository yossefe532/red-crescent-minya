/**
 * Mission Requirements & Questions Service
 * Handles requirement/question CRUD, answer storage, validation.
 */
import { generateUUID } from '../utils/id';

// ─── Types ────────────────────────────────────────────
export interface MissionRequirement {
  id: string;
  mission_id: string;
  type: string;
  text: string;
  requires_acceptance: number;
  auto_verify: number;
  sort_order: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface MissionQuestion {
  id: string;
  mission_id: string;
  question_text: string;
  question_type: string;
  required: number;
  options: string; // JSON array
  sort_order: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface RegistrationAnswer {
  id: string;
  registration_id: string;
  question_id: string;
  answer_text: string;
  answered_at: string;
  created_at: string;
}

// ─── Requirements CRUD ────────────────────────────────

/** Get all active requirements for a mission */
export async function getMissionRequirements(
  db: D1Database,
  missionId: string
): Promise<MissionRequirement[]> {
  const result = await db
    .prepare(
      `SELECT id, mission_id, type, text, requires_acceptance, auto_verify, sort_order, active, created_at, updated_at
       FROM mission_requirements
       WHERE mission_id = ? AND active = 1
       ORDER BY sort_order ASC, created_at ASC`
    )
    .bind(missionId)
    .all();
  return (result.results || []) as unknown as MissionRequirement[];
}

/** Get all requirements for a mission (including inactive — for admin) */
export async function getAllMissionRequirements(
  db: D1Database,
  missionId: string
): Promise<MissionRequirement[]> {
  const result = await db
    .prepare(
      `SELECT id, mission_id, type, text, requires_acceptance, auto_verify, sort_order, active, created_at, updated_at
       FROM mission_requirements
       WHERE mission_id = ?
       ORDER BY sort_order ASC, created_at ASC`
    )
    .bind(missionId)
    .all();
  return (result.results || []) as unknown as MissionRequirement[];
}

/** Get a single requirement by ID */
export async function getRequirementById(
  db: D1Database,
  requirementId: string
): Promise<MissionRequirement | null> {
  const result = await db
    .prepare(
      `SELECT id, mission_id, type, text, requires_acceptance, auto_verify, sort_order, active, created_at, updated_at
       FROM mission_requirements WHERE id = ?`
    )
    .bind(requirementId)
    .first();
  return (result || null) as unknown as MissionRequirement | null;
}

/** Create a new requirement */
export async function createRequirement(
  db: D1Database,
  missionId: string,
  type: string,
  text: string,
  requiresAcceptance: number,
  autoVerify: number,
  sortOrder: number
): Promise<MissionRequirement> {
  const id = generateUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO mission_requirements (id, mission_id, type, text, requires_acceptance, auto_verify, sort_order, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .bind(id, missionId, type, text, requiresAcceptance, autoVerify, sortOrder, now, now)
    .run();

  return {
    id,
    mission_id: missionId,
    type,
    text,
    requires_acceptance: requiresAcceptance,
    auto_verify: autoVerify,
    sort_order: sortOrder,
    active: 1,
    created_at: now,
    updated_at: now,
  };
}

/** Update a requirement's fields */
export async function updateRequirement(
  db: D1Database,
  requirementId: string,
  updates: Partial<Pick<MissionRequirement, 'type' | 'text' | 'requires_acceptance' | 'auto_verify' | 'sort_order' | 'active'>>
): Promise<MissionRequirement | null> {
  const now = new Date().toISOString();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.type !== undefined) { fields.push('type = ?'); values.push(updates.type); }
  if (updates.text !== undefined) { fields.push('text = ?'); values.push(updates.text); }
  if (updates.requires_acceptance !== undefined) { fields.push('requires_acceptance = ?'); values.push(updates.requires_acceptance); }
  if (updates.auto_verify !== undefined) { fields.push('auto_verify = ?'); values.push(updates.auto_verify); }
  if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(updates.sort_order); }
  if (updates.active !== undefined) { fields.push('active = ?'); values.push(updates.active); }

  if (fields.length === 0) return null;

  fields.push('updated_at = ?');
  values.push(now);
  values.push(requirementId);

  await db
    .prepare(`UPDATE mission_requirements SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return getRequirementById(db, requirementId);
}

/** Soft-delete a requirement */
export async function deleteRequirement(
  db: D1Database,
  requirementId: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare('UPDATE mission_requirements SET active = 0, updated_at = ? WHERE id = ?')
    .bind(now, requirementId)
    .run();
}

// ─── Questions CRUD ───────────────────────────────────

/** Get all active questions for a mission */
export async function getMissionQuestions(
  db: D1Database,
  missionId: string
): Promise<MissionQuestion[]> {
  const result = await db
    .prepare(
      `SELECT id, mission_id, question_text, question_type, required, options, sort_order, active, created_at, updated_at
       FROM mission_questions
       WHERE mission_id = ? AND active = 1
       ORDER BY sort_order ASC, created_at ASC`
    )
    .bind(missionId)
    .all();
  return (result.results || []) as unknown as MissionQuestion[];
}

/** Get all questions for a mission (including inactive — for admin) */
export async function getAllMissionQuestions(
  db: D1Database,
  missionId: string
): Promise<MissionQuestion[]> {
  const result = await db
    .prepare(
      `SELECT id, mission_id, question_text, question_type, required, options, sort_order, active, created_at, updated_at
       FROM mission_questions
       WHERE mission_id = ?
       ORDER BY sort_order ASC, created_at ASC`
    )
    .bind(missionId)
    .all();
  return (result.results || []) as unknown as MissionQuestion[];
}

/** Get a single question by ID */
export async function getQuestionById(
  db: D1Database,
  questionId: string
): Promise<MissionQuestion | null> {
  const result = await db
    .prepare(
      `SELECT id, mission_id, question_text, question_type, required, options, sort_order, active, created_at, updated_at
       FROM mission_questions WHERE id = ?`
    )
    .bind(questionId)
    .first();
  return (result || null) as unknown as MissionQuestion | null;
}

/** Create a new question */
export async function createQuestion(
  db: D1Database,
  missionId: string,
  questionText: string,
  questionType: string,
  required: number,
  options: string,
  sortOrder: number
): Promise<MissionQuestion> {
  const id = generateUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO mission_questions (id, mission_id, question_text, question_type, required, options, sort_order, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .bind(id, missionId, questionText, questionType, required, options, sortOrder, now, now)
    .run();

  return {
    id,
    mission_id: missionId,
    question_text: questionText,
    question_type: questionType,
    required,
    options,
    sort_order: sortOrder,
    active: 1,
    created_at: now,
    updated_at: now,
  };
}

/** Update a question's fields */
export async function updateQuestion(
  db: D1Database,
  questionId: string,
  updates: Partial<Pick<MissionQuestion, 'question_text' | 'question_type' | 'required' | 'options' | 'sort_order' | 'active'>>
): Promise<MissionQuestion | null> {
  const now = new Date().toISOString();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.question_text !== undefined) { fields.push('question_text = ?'); values.push(updates.question_text); }
  if (updates.question_type !== undefined) { fields.push('question_type = ?'); values.push(updates.question_type); }
  if (updates.required !== undefined) { fields.push('required = ?'); values.push(updates.required); }
  if (updates.options !== undefined) { fields.push('options = ?'); values.push(updates.options); }
  if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(updates.sort_order); }
  if (updates.active !== undefined) { fields.push('active = ?'); values.push(updates.active); }

  if (fields.length === 0) return null;

  fields.push('updated_at = ?');
  values.push(now);
  values.push(questionId);

  await db
    .prepare(`UPDATE mission_questions SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return getQuestionById(db, questionId);
}

/** Soft-delete a question */
export async function deleteQuestion(
  db: D1Database,
  questionId: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare('UPDATE mission_questions SET active = 0, updated_at = ? WHERE id = ?')
    .bind(now, questionId)
    .run();
}

// ─── Registration Answers ─────────────────────────────

/** Save answers for a registration */
export async function saveRegistrationAnswers(
  db: D1Database,
  registrationId: string,
  answers: Array<{ question_id: string; answer_text: string }>
): Promise<void> {
  const now = new Date().toISOString();
  // Filter out incomplete entries (blank text or missing question)
  const valid = answers.filter(
    (a) => a.question_id && a.answer_text && a.answer_text.trim() !== ''
  );
  // Full-replace semantics: the submitted set is authoritative.
  // Allows clearing all answers (empty valid set) and corrects removals.
  await db
    .prepare(`DELETE FROM registration_answers WHERE registration_id = ?`)
    .bind(registrationId)
    .run();
  if (valid.length === 0) return;
  for (const ans of valid) {
    const id = generateUUID();
    await db
      .prepare(
        `INSERT OR REPLACE INTO registration_answers (id, registration_id, question_id, answer_text, answered_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(id, registrationId, ans.question_id, ans.answer_text.trim(), now, now)
      .run();
  }
}

/** Get all answers for a registration */
export async function getRegistrationAnswers(
  db: D1Database,
  registrationId: string
): Promise<RegistrationAnswer[]> {
  const result = await db
    .prepare(
      `SELECT id, registration_id, question_id, answer_text, answered_at, created_at
       FROM registration_answers
       WHERE registration_id = ?`
    )
    .bind(registrationId)
    .all();
  return (result.results || []) as unknown as RegistrationAnswer[];
}

/** Get all answers for a registration (by registration ID, including all questions) */
export async function getAnswersByRegistration(
  db: D1Database,
  registrationId: string
): Promise<RegistrationAnswer[]> {
  return getRegistrationAnswers(db, registrationId);
}

/** Get answers for all registrations in a mission, grouped by question */
export async function getQuestionWithAnswers(
  db: D1Database,
  missionId: string
): Promise<Array<MissionQuestion & { answers: RegistrationAnswer[] }>> {
  const questions = await getMissionQuestions(db, missionId);
  const result: Array<MissionQuestion & { answers: RegistrationAnswer[] }> = [];
  for (const q of questions) {
    const allAnswers = await db
      .prepare(
        `SELECT ra.id, ra.registration_id, ra.question_id, ra.answer_text, ra.answered_at, ra.created_at
         FROM registration_answers ra
         WHERE ra.question_id = ?`
      )
      .bind(q.id)
      .all();
    result.push({ ...q, answers: (allAnswers.results || []) as unknown as RegistrationAnswer[] });
  }
  return result;
}

// ─── Validation ───────────────────────────────────────

/** Validate that all requirements are met for a registration */
export async function validateRequirements(
  db: D1Database,
  missionId: string,
  body: Record<string, unknown>
): Promise<{ valid: boolean; errors: string[] }> {
  const requirements = await getMissionRequirements(db, missionId);
  const errors: string[] = [];

  for (const req of requirements) {
    // Check acceptance checkbox for requirements that require it
    if (req.requires_acceptance) {
      const accepted = body.requirement_accepted as Record<string, unknown> | undefined;
      if (!accepted || !accepted[req.id]) {
        errors.push(`يجب قبول: ${req.text}`);
      }
    }

    // Auto-verify for specific types if data is available
    if (req.auto_verify && req.type === 'AGE') {
      const age = body.volunteer_age as number | undefined;
      if (age !== undefined && age < 16) {
        errors.push(`العمر المطلوب: ${req.text}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
