/**
 * Mission Requirements & Questions — Full Test Suite
 * Tests: migration, service CRUD, registration validation, answer storage
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateUUID } from '../src/utils/id';

// ─── D1 In-Memory SQLite Shim (matches phase5 pattern) ───────
function createTestD1(): any {
  const sqlite = new DatabaseSync(':memory:');

  const migrationsDir = path.join(process.cwd(), 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f: string) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    sqlite.exec(sql);
  }

  const d1 = {
    prepare(sql: string) {
      return {
        _sql: sql,
        _params: [] as any[],
        bind(...params: any[]) {
          this._params = params.map((p: any) => (p === undefined ? null : p));
          return this;
        },
        async first<T = any>(col?: string): Promise<T | null> {
          try {
            const stmt = sqlite.prepare(this._sql);
            const row = stmt.get(...this._params) as any;
            if (!row) return null;
            if (col) return row[col] ?? null;
            return row as T;
          } catch (e) {
            console.error('D1 first error on SQL:', this._sql, this._params, e);
            throw e;
          }
        },
        async all<T = any>(): Promise<{ results: T[] }> {
          try {
            const stmt = sqlite.prepare(this._sql);
            const rows = stmt.all(...this._params) as T[];
            return { results: rows };
          } catch (e) {
            console.error('D1 all error on SQL:', this._sql, this._params, e);
            throw e;
          }
        },
        async run(): Promise<{ success: boolean; meta: any }> {
          try {
            const stmt = sqlite.prepare(this._sql);
            const result = stmt.run(...this._params);
            return { success: true, meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
          } catch (e) {
            console.error('D1 run error on SQL:', this._sql, this._params, e);
            throw e;
          }
        },
      };
    },
  };
  return d1;
}

// ─── Seed helpers ──────────────────────────────────────────────
async function seedMission(d1: any, overrides: Record<string, any> = {}) {
  const missionId = overrides.id || 'mission-req-1';
  const now = new Date().toISOString();
  const start_at = overrides.start_at || new Date(Date.now() + 86400000).toISOString(); // tomorrow
  const end_at = overrides.end_at || new Date(Date.now() + 172800000).toISOString(); // +2 days
  await d1.prepare(`
    INSERT INTO missions (id, public_code, title, status, capacity, waiting_list, start_at, end_at, confirmation_phrase, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    missionId,
    overrides.public_code || 'REQ001',
    overrides.title || 'مهمة اختبار المتطلبات',
    overrides.status || 'OPEN',
    overrides.capacity ?? 5,
    overrides.waiting_list ?? 3,
    start_at, end_at,
    overrides.confirmation_phrase || 'أتعهد',
    now, now
  ).run();
  return missionId;
}

async function seedVolunteer(d1: any, memberId: string = 'V001', name: string = 'متطوع اختبار') {
  const volId = generateUUID();
  const now = new Date().toISOString();
  await d1.prepare(`
    INSERT INTO volunteers (id, member_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(volId, memberId, name, now, now).run();
  return volId;
}

// ─── Test Infrastructure ──────────────────────────────────────
let passCount = 0;
let failCount = 0;
let testCount = 0;

function testGroup(name: string) {
  console.log(`\n--- ${name} ---`);
}

function assert(condition: boolean, msg: string) {
  testCount++;
  if (condition) {
    passCount++;
    console.log(`  ✅ [PASS] ${msg}`);
  } else {
    failCount++;
    console.log(`  ❌ [FAIL] ${msg}`);
  }
}

function assertEqual(actual: any, expected: any, msg: string) {
  assert(actual === expected, `${msg} (got: ${JSON.stringify(actual)}, expected: ${JSON.stringify(expected)})`);
}

// ─── Import service functions ────────────────────────────────
import {
  getMissionRequirements,
  getMissionQuestions,
  createRequirement,
  updateRequirement,
  deleteRequirement,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  saveRegistrationAnswers,
  getRegistrationAnswers,
  getQuestionWithAnswers,
} from '../src/services/mission.requirements.service';

// ─── Tests ───────────────────────────────────────────────────

async function runTests() {
  const d1 = createTestD1();
  const missionId = await seedMission(d1);
  const volId = await seedVolunteer(d1);

  // ═══════════════════════════════════════════════
  // GROUP 1: Migration & Schema Verification
  // ═══════════════════════════════════════════════
  testGroup('1. Migration & Schema Verification');

  const tables = await d1.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all();
  const tableNames = (tables.results || tables).map((t: any) => t.name);
  assert(tableNames.includes('mission_requirements'), 'mission_requirements table exists');
  assert(tableNames.includes('mission_questions'), 'mission_questions table exists');
  assert(tableNames.includes('registration_answers'), 'registration_answers table exists');

  const reqCols = await d1.prepare(`PRAGMA table_info(mission_requirements)`).all();
  const reqColNames = (reqCols.results || reqCols).map((c: any) => c.name);
  assert(reqColNames.includes('id'), 'mission_requirements has id');
  assert(reqColNames.includes('mission_id'), 'mission_requirements has mission_id');
  assert(reqColNames.includes('type'), 'mission_requirements has type');
  assert(reqColNames.includes('text'), 'mission_requirements has text');
  assert(reqColNames.includes('requires_acceptance'), 'mission_requirements has requires_acceptance');

  const qCols = await d1.prepare(`PRAGMA table_info(mission_questions)`).all();
  const qColNames = (qCols.results || qCols).map((c: any) => c.name);
  assert(qColNames.includes('id'), 'mission_questions has id');
  assert(qColNames.includes('mission_id'), 'mission_questions has mission_id');
  assert(qColNames.includes('question_text'), 'mission_questions has question_text');
  assert(qColNames.includes('question_type'), 'mission_questions has question_type');
  assert(qColNames.includes('options'), 'mission_questions has options');

  const aCols = await d1.prepare(`PRAGMA table_info(registration_answers)`).all();
  const aColNames = (aCols.results || aCols).map((c: any) => c.name);
  assert(aColNames.includes('id'), 'registration_answers has id');
  assert(aColNames.includes('registration_id'), 'registration_answers has registration_id');
  assert(aColNames.includes('question_id'), 'registration_answers has question_id');
  assert(aColNames.includes('answer_text'), 'registration_answers has answer_text');

  // ═══════════════════════════════════════════════
  // GROUP 2: Requirement CRUD
  // ═══════════════════════════════════════════════
  testGroup('2. Requirement CRUD');

  const req1 = await createRequirement(d1, missionId, 'AGE', 'يجب أن يكون عمر المتطوع 18 سنة على الأقل', 1, 0, 1);
  assert(req1.id !== undefined, 'Requirement 1 created with id');
  assertEqual(req1.type, 'AGE', 'Req1 type is AGE');
  assertEqual(req1.requires_acceptance, 1, 'Req1 requires_acceptance = 1');

  const req2 = await createRequirement(d1, missionId, 'TEXT', 'يجب أن يكون لديك خبرة في الإسعافات الأولية', 1, 0, 2);
  assert(req2.id !== undefined, 'Requirement 2 created');

  const req3 = await createRequirement(d1, missionId, 'CUSTOM', 'متطلب مخصص', 0, 0, 3);
  assert(req3.id !== undefined, 'Requirement 3 created (CUSTOM type)');

  const reqs = await getMissionRequirements(d1, missionId);
  assertEqual(reqs.length, 3, 'Got 3 requirements');
  assertEqual(reqs[0].type, 'AGE', 'First requirement is AGE');

  const updated = await updateRequirement(d1, req1.id, { text: 'العمر 18+' });
  assert(updated !== null, 'Update requirement returns result');
  assertEqual(updated!.text, 'العمر 18+', 'Requirement text updated');

  await deleteRequirement(d1, req3.id);
  const afterDelete = await getMissionRequirements(d1, missionId);
  assertEqual(afterDelete.length, 2, 'After delete: 2 requirements remain');

  // ═══════════════════════════════════════════════
  // GROUP 3: Question CRUD
  // ═══════════════════════════════════════════════
  testGroup('3. Question CRUD');

  const q1Options = JSON.stringify(['نعم', 'لا']);
  const q1 = await createQuestion(d1, missionId, 'هل لديك خبرة سابقة في المهمات؟', 'YES_NO', 1, q1Options, 1);
  assert(q1.id !== undefined, 'Question 1 created (YES_NO)');
  assertEqual(q1.question_type, 'YES_NO', 'Q1 type is YES_NO');

  const q2Options = JSON.stringify(['إسعافات أولية', 'سلطات إدارية']);
  const q2 = await createQuestion(d1, missionId, 'ما هي خبراتك؟', 'MULTIPLE_CHOICE', 0, q2Options, 2);
  assert(q2.id !== undefined, 'Question 2 created (MULTIPLE_CHOICE)');

  const q3 = await createQuestion(d1, missionId, 'أكتب أي ملاحظات إضافية', 'TEXT', 0, '[]', 3);
  assert(q3.id !== undefined, 'Question 3 created (TEXT)');

  const questions = await getMissionQuestions(d1, missionId);
  assertEqual(questions.length, 3, 'Got 3 questions');
  assertEqual(questions[0].question_type, 'YES_NO', 'First question is YES_NO');

  const updatedQ = await updateQuestion(d1, q1.id, { question_text: 'هل لديك خبرة؟' });
  assert(updatedQ !== null, 'Update question returns result');
  assertEqual(updatedQ!.question_text, 'هل لديك خبرة؟', 'Question text updated');

  await deleteQuestion(d1, q3.id);
  const afterDeleteQ = await getMissionQuestions(d1, missionId);
  assertEqual(afterDeleteQ.length, 2, 'After delete: 2 questions remain');

  // ═══════════════════════════════════════════════
  // GROUP 4: Registration Answer Storage
  // ═══════════════════════════════════════════════
  testGroup('4. Registration Answer Storage');

  const regId = generateUUID();
  const now = new Date().toISOString();
  await d1.prepare(`
    INSERT INTO registrations (id, volunteer_id, mission_id, status, registration_sequence, request_id, created_at, confirmed_at)
    VALUES (?, ?, ?, 'CONFIRMED', 1, 'req-test-ans1', ?, ?)
  `).bind(regId, volId, missionId, now, now).run();

  const answers = [
    { question_id: q1.id, answer_text: 'نعم' },
    { question_id: q2.id, answer_text: 'إسعافات أولية,سلطات إدارية' },
  ];
  await saveRegistrationAnswers(d1, regId, answers);

  const savedAnswers = await getRegistrationAnswers(d1, regId);
  assertEqual(savedAnswers.length, 2, 'Saved 2 answers');

  const yesAnswer = savedAnswers.find((a: any) => a.question_id === q1.id);
  assertEqual(yesAnswer?.answer_text, 'نعم', 'YES_NO answer saved correctly');

  const mcAnswer = savedAnswers.find((a: any) => a.question_id === q2.id);
  assertEqual(mcAnswer?.answer_text, 'إسعافات أولية,سلطات إدارية', 'MC answer saved correctly');

  // Overwrite answers (idempotent)
  const updatedAnswers = [
    { question_id: q1.id, answer_text: 'لا' },
    { question_id: q2.id, answer_text: 'سلطات إدارية' },
  ];
  await saveRegistrationAnswers(d1, regId, updatedAnswers);
  const afterUpdate = await getRegistrationAnswers(d1, regId);
  assertEqual(afterUpdate.length, 2, 'Still 2 answers after overwrite');
  const updatedYes = afterUpdate.find((a: any) => a.question_id === q1.id);
  assertEqual(updatedYes?.answer_text, 'لا', 'Answer overwritten correctly');

  // ═══════════════════════════════════════════════
  // GROUP 5: Question With Answers (Admin View)
  // ═══════════════════════════════════════════════
  testGroup('5. Question With Answers (Admin View)');

  const qWithAnswers = await getQuestionWithAnswers(d1, missionId);
  assertEqual(qWithAnswers.length, 2, 'Got 2 questions with answers');

  const q1WithAns = qWithAnswers.find((q: any) => q.id === q1.id);
  assert(q1WithAns !== undefined, 'Found Q1 in results');
  assertEqual(q1WithAns!.answers.length, 1, 'Q1 has 1 answer');
  assertEqual(q1WithAns!.answers[0].answer_text, 'لا', 'Q1 answer is "لا"');

  // ═══════════════════════════════════════════════
  // GROUP 6: Backward Compatibility
  // ═══════════════════════════════════════════════
  testGroup('6. Backward Compatibility');

  const noReqMissionId = await seedMission(d1, { id: 'mission-no-req', public_code: 'NOREQ01' });
  const noReqs = await getMissionRequirements(d1, noReqMissionId);
  assertEqual(noReqs.length, 0, 'Mission without requirements → empty array');
  const noQs = await getMissionQuestions(d1, noReqMissionId);
  assertEqual(noQs.length, 0, 'Mission without questions → empty array');

  const emptyAnswers = await getRegistrationAnswers(d1, 'non-existent-registration');
  assertEqual(emptyAnswers.length, 0, 'Non-existent registration → empty answers');

  // ═══════════════════════════════════════════════
  // GROUP 7: Cascade Delete
  // ═══════════════════════════════════════════════
  testGroup('7. Cascade Delete Verification');

  const cascadeMissionId = await seedMission(d1, { id: 'mission-cascade', public_code: 'CASCADE01' });
  const cascadeReq = await createRequirement(d1, cascadeMissionId, 'CUSTOM', 'متطلب للحذف', 0, 0, 1);
  const cascadeQ = await createQuestion(d1, cascadeMissionId, 'سؤال للحذف', 'TEXT', 0, '[]', 1);

  const cascadeReqs = await getMissionRequirements(d1, cascadeMissionId);
  assertEqual(cascadeReqs.length, 1, 'Cascade mission has 1 requirement before delete');

  await deleteRequirement(d1, cascadeReq.id);
  const afterCascadeReq = await getMissionRequirements(d1, cascadeMissionId);
  assertEqual(afterCascadeReq.length, 0, 'Cascade mission has 0 requirements after delete');

  await deleteQuestion(d1, cascadeQ.id);
  const afterCascadeQ = await getMissionQuestions(d1, cascadeMissionId);
  assertEqual(afterCascadeQ.length, 0, 'Cascade mission has 0 questions after delete');

  // ═══════════════════════════════════════════════
  // GROUP 8: Requirement Types
  // ═══════════════════════════════════════════════
  testGroup('8. Requirement Types');

  const types = ['AGE', 'GENDER', 'ROLE', 'MEMBERSHIP', 'TEXT', 'CUSTOM'];
  for (const type of types) {
    const req = await createRequirement(d1, missionId, type, `متطلب من نوع ${type}`, 0, 0, 99);
    assert(req.id !== undefined, `Create requirement type=${type} succeeds`);
  }

  // ═══════════════════════════════════════════════
  // GROUP 9: Question Types
  // ═══════════════════════════════════════════════
  testGroup('9. Question Types');

  const qTypes = [
    { type: 'YES_NO', options: JSON.stringify(['نعم', 'لا']) },
    { type: 'SINGLE_CHOICE', options: JSON.stringify(['أ', 'ب', 'ج']) },
    { type: 'MULTIPLE_CHOICE', options: JSON.stringify(['أ', 'ب', 'ج']) },
    { type: 'TEXT', options: '[]' },
  ];
  for (const q of qTypes) {
    const question = await createQuestion(d1, missionId, `سؤال من نوع ${q.type}`, q.type as any, 0, q.options, 99);
    assert(question.id !== undefined, `Create question type=${q.type} succeeds`);
  }

  // ═══════════════════════════════════════════════
  // GROUP 10: Edge Cases
  // ═══════════════════════════════════════════════
  testGroup('10. Edge Cases');

  const nonExistent = await updateRequirement(d1, 'non-existent-id', { text: 'test' });
  assert(nonExistent === null, 'Update non-existent requirement returns null');

  const nonExistentQ = await updateQuestion(d1, 'non-existent-id', { question_text: 'test' });
  assert(nonExistentQ === null, 'Update non-existent question returns null');

  await saveRegistrationAnswers(d1, regId, []);
  const afterEmpty = await getRegistrationAnswers(d1, regId);
  assertEqual(afterEmpty.length, 0, 'Empty answers array clears existing answers');

  await saveRegistrationAnswers(d1, regId, [{ question_id: q1.id, answer_text: '' }]);
  const afterBlank = await getRegistrationAnswers(d1, regId);
  assertEqual(afterBlank.length, 0, 'Blank answer_text is filtered out by service');

  // ═══════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`📊 MISSION REQUIREMENTS TEST RESULTS: ${passCount}/${testCount} passed, ${failCount} failed`);
  console.log('═══════════════════════════════════════════════════════');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
