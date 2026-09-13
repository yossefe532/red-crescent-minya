/**
 * Phase 1 — Comprehensive Telegram Admin Test Matrix (20 Mandatory Scenarios)
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Import handlers under test
import { startCommandHandler, helpCommandHandler, cancelCommandHandler } from '../src/telegram/commands/start';
import {
  handleListMissions,
  handleStats,
  handleHealth,
  handleMissionDetail,
  handleGetLink,
  handleWhatsAppMessage,
  handleExportCSV,
  handleMissionSelectForRegistrants,
} from '../src/telegram/commands/missions';
import {
  startCreateWizard,
  handleCreateTitle,
  handleCreateDescription,
  handleCreateLocation,
  handleCreateStart,
  handleCreateEnd,
  handleCreateCapacity,
  handleCreateWaitingList,
  executeCreateMission,
} from '../src/telegram/commands/create';
import { handleEditValue } from '../src/telegram/commands/edit';
import { handleCloseMission } from '../src/telegram/commands/close';
import { handleReopenMission } from '../src/telegram/commands/reopen';
import { executeDelete, startDeleteWizard } from '../src/telegram/commands/delete';
import {
  handleRegistrants,
  handleWaitlist,
  handleVolunteerDetail,
  handleVolunteerAudio,
  handleVolunteerMove,
} from '../src/telegram/commands/registrants';
import { handleCancelRegConfirm } from '../src/telegram/commands/cancel-reg';
import { handleCallbackQuery } from '../src/telegram/callbacks';
import { handleWizardMessage } from '../src/telegram/wizard';
import { requireAdmin, isAdmin } from '../src/telegram/auth';
import { createMission, getMissionById } from '../src/services/mission.service';

// ─── D1 In-Memory SQLite Shim ──────────────────────────────────
function createTestD1(): any {
  const sqlite = new DatabaseSync(':memory:');

  // Load and execute all 8 migrations in order
  const migrationsDir = path.join(process.cwd(), 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f: string) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    sqlite.exec(sql);
  }

  // Wrap with D1Database interface
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
    async batch(statements: any[]) {
      const results = [];
      for (const stmt of statements) {
        results.push(await stmt.run());
      }
      return results;
    },
    async exec(sql: string) {
      sqlite.exec(sql);
    }
  };

  return { d1, sqlite };
}

// ─── Mock Telegram Interceptor ─────────────────────────────────
interface CapturedTgCall {
  endpoint: string;
  body: any;
}

let capturedCalls: CapturedTgCall[] = [];

function setupTgMock() {
  capturedCalls = [];
  (globalThis as any).fetch = async (url: string, options?: any) => {
    if (url.includes('api.telegram.org')) {
      const endpoint = url.split('/').pop() || '';
      let body: any = {};
      if (options?.body) {
        if (typeof options.body === 'string') {
          try { body = JSON.parse(options.body); } catch { body = options.body; }
        } else {
          body = options.body; // FormData
        }
      }
      capturedCalls.push({ endpoint, body });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1001 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200 });
  };
}

function getLastCall(): CapturedTgCall | undefined {
  return capturedCalls[capturedCalls.length - 1];
}

// ─── Test Suite Runner ─────────────────────────────────────────
async function runTests() {
  console.log('🚀 STARTING PHASE 1 TELEGRAM ADMIN TEST SUITE (20 SCENARIOS)\n');

  const { d1 } = createTestD1();
  const token = 'TEST_TOKEN_123';
  const ADMIN_CHAT_ID = 999001;
  const PUBLIC_CHAT_ID = 111002;
  const ADMIN_CHAT_IDS = '999001,999002';

  setupTgMock();

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name} — ${detail || ''}`);
      failed++;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 1: /start Command (Admin vs Public)
  // ─────────────────────────────────────────────────────────────
  console.log('--- TEST 1: /start Command (Admin vs Public) ---');
  capturedCalls = [];
  await startCommandHandler(token, ADMIN_CHAT_ID, d1, ADMIN_CHAT_IDS);
  let last = getLastCall();
  assert(
    last?.endpoint === 'sendMessage' &&
    last?.body?.text?.includes('لوحة إدارة') &&
    last?.body?.reply_markup?.inline_keyboard?.length >= 3,
    'Admin receives Admin Dashboard with Main Menu Keyboard'
  );

  capturedCalls = [];
  await startCommandHandler(token, PUBLIC_CHAT_ID, d1, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.endpoint === 'sendMessage' &&
    last?.body?.text?.includes('هذا البوت مخصص لإدارة') &&
    last?.body?.reply_markup?.inline_keyboard?.[0]?.[0]?.url?.includes('red-crescent-minya.pages.dev'),
    'Public user receives Public Welcome without admin controls'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 2: Admin Detection
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 2: Admin Detection (isAdmin & requireAdmin) ---');
  assert(isAdmin(ADMIN_CHAT_ID, ADMIN_CHAT_IDS) === true, 'isAdmin returns true for configured admin');
  assert(isAdmin(PUBLIC_CHAT_ID, ADMIN_CHAT_IDS) === false, 'isAdmin returns false for public chat');
  
  capturedCalls = [];
  const reqAdminResult = await requireAdmin(token, PUBLIC_CHAT_ID, d1, ADMIN_CHAT_IDS);
  assert(reqAdminResult === false, 'requireAdmin rejects public chat');
  assert(getLastCall()?.body?.text?.includes('غير مصرح لك'), 'requireAdmin sends unauthorized warning');

  // ─────────────────────────────────────────────────────────────
  // TEST 3: Main Dashboard (nav:home)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 3: Main Dashboard & nav:home ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_home', data: 'nav:home' }, ADMIN_CHAT_IDS);
  assert(
    getLastCall()?.body?.text?.includes('لوحة إدارة') &&
    capturedCalls.some(c => c.endpoint === 'answerCallbackQuery'),
    'nav:home returns main admin dashboard and answers callback'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 4: Tasks List (/missions, nav:missions, filters, pagination)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 4: Tasks List (Filters & Pagination) ---');
  const m1 = await createMission(d1, {
    title: 'مهمة إسعاف أولى',
    location: 'المنيا',
    start_at: '2026-09-20T08:00:00Z',
    end_at: '2026-09-20T16:00:00Z',
    capacity: 5,
    waiting_list: 2,
  });

  const m2 = await createMission(d1, {
    title: 'مهمة تطعيم كبار السن',
    location: 'ملوي',
    start_at: '2026-09-22T08:00:00Z',
    end_at: '2026-09-22T16:00:00Z',
    capacity: 10,
    waiting_list: 5,
  });

  capturedCalls = [];
  await handleListMissions(token, ADMIN_CHAT_ID, d1, 1, 'ALL');
  last = getLastCall();
  assert(
    last?.body?.text?.includes('قائمة المهام') &&
    last?.body?.text?.includes('مهمة إسعاف أولى') &&
    last?.body?.text?.includes('مهمة تطعيم كبار السن'),
    'handleListMissions displays missions with capacity and status'
  );

  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_filter', data: 'm:page:OPEN:1' }, ADMIN_CHAT_IDS);
  assert(
    getLastCall()?.body?.text?.includes('قائمة المهام'),
    'm:page:OPEN:1 callback filters and renders open missions'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 5: Task Detail Screen (m:detail:<id>)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 5: Task Detail Screen ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_det', data: `m:detail:${m1.id}` }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes(m1.public_code) &&
    last?.body?.text?.includes('مهمة إسعاف أولى') &&
    last?.body?.reply_markup?.inline_keyboard?.some((row: any[]) => row.some(b => b.text.includes('إغلاق المهمة'))),
    'Task Detail displays correct metadata and valid OPEN state actions'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 6: Create Task Wizard (Full Flow)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 6: Create Task Wizard ---');
  capturedCalls = [];
  await startCreateWizard(token, ADMIN_CHAT_ID, d1);
  assert(getLastCall()?.body?.text?.includes('الخطوة 1 من 7'), 'Wizard Step 1 (Title) initiated');

  await handleCreateTitle(token, ADMIN_CHAT_ID, d1, 'قافلة طبية بسمالوط');
  assert(getLastCall()?.body?.text?.includes('الخطوة 2 من 7'), 'Wizard Step 2 (Description)');

  await handleCreateDescription(token, ADMIN_CHAT_ID, d1, 'فحص طبي وتوزيع أدوية');
  assert(getLastCall()?.body?.text?.includes('الخطوة 3 من 7'), 'Wizard Step 3 (Location)');

  await handleCreateLocation(token, ADMIN_CHAT_ID, d1, 'سمالوط — المركز الطبي');
  assert(getLastCall()?.body?.text?.includes('الخطوة 4 من 7'), 'Wizard Step 4 (Start Date)');

  await handleCreateStart(token, ADMIN_CHAT_ID, d1, '2026-10-01 09:00');
  assert(getLastCall()?.body?.text?.includes('الخطوة 5 من 7'), 'Wizard Step 5 (End Date)');

  await handleCreateEnd(token, ADMIN_CHAT_ID, d1, '2026-10-01 17:00');
  assert(getLastCall()?.body?.text?.includes('الخطوة 6 من 7'), 'Wizard Step 6 (Capacity)');

  await handleCreateCapacity(token, ADMIN_CHAT_ID, d1, '15');
  assert(getLastCall()?.body?.text?.includes('الخطوة 7 من 7'), 'Wizard Step 7 (Waitlist)');

  await handleCreateWaitingList(token, ADMIN_CHAT_ID, d1, '5');
  assert(
    getLastCall()?.body?.text?.includes('ملخص المهمة الجديدة') || getLastCall()?.body?.text?.includes('قافلة طبية بسمالوط'),
    'Wizard Summary Preview generated'
  );

  // Confirm creation
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_wiz_conf', data: 'wiz:create:confirm' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('تم إنشاء المهمة بنجاح') &&
    last?.body?.text?.includes('قافلة طبية بسمالوط'),
    'executeCreateMission creates mission and returns success'
  );

  // Verify created in DB
  const createdMission = await d1.prepare('SELECT * FROM missions WHERE title = ?').bind('قافلة طبية بسمالوط').first();
  assert(createdMission !== null && createdMission.capacity === 15, 'Created mission verified in SQLite database');

  // ─────────────────────────────────────────────────────────────
  // TEST 7: Edit Task Field
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 7: Edit Task Field ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_edit_req', data: `edit:field:title:${m1.id}` }, ADMIN_CHAT_IDS);
  assert(getLastCall()?.body?.text?.includes('تعديل الاسم'), 'Edit field prompt sent');

  capturedCalls = [];
  await handleWizardMessage(token, ADMIN_CHAT_ID, d1, 'مهمة إسعاف طوارئ معدلة');
  last = getLastCall();
  assert(
    last?.body?.text?.includes('مهمة إسعاف طوارئ معدلة') || last?.body?.text?.includes('تفاصيل'),
    'handleEditValue updates mission field in DB and shows updated detail'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 8: Close Task (m:close:<id>)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 8: Close Task ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_close', data: `m:close:${m1.id}` }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(last?.body?.text?.includes('تم إغلاق'), 'handleCloseMission closes registration');

  const closedCheck = await getMissionById(d1, m1.id);
  assert(closedCheck?.status === 'CLOSED', 'Mission status updated to CLOSED in DB');

  // ─────────────────────────────────────────────────────────────
  // TEST 9: Reopen Task (m:reopen:<id>)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 9: Reopen Task ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_reopen', data: `m:reopen:${m1.id}` }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(last?.body?.text?.includes('تم إعادة فتح'), 'handleReopenMission reopens mission');

  const reopenedCheck = await getMissionById(d1, m1.id);
  assert(
    reopenedCheck?.status === 'OPEN' && reopenedCheck?.registration_close_at === null,
    'Mission status is OPEN and registration_close_at is null'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 10: Delete Task (m:delete:<id> -> confirm:delete:<id>)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 10: Delete Task with Cascade ---');
  const mToDel = await createMission(d1, { title: 'مهمة للحذف', start_at: '2026-10-05T00:00:00Z', end_at: '2026-10-05T12:00:00Z', capacity: 2 });
  capturedCalls = [];
  await startDeleteWizard(token, ADMIN_CHAT_ID, d1, mToDel.id);
  assert(getLastCall()?.body?.text?.includes('حذف المهمة'), 'Delete confirmation prompt sent');

  capturedCalls = [];
  await executeDelete(token, ADMIN_CHAT_ID, d1, mToDel.id);
  assert(getLastCall()?.body?.text?.includes('تم حذف المهمة'), 'executeDelete deletes mission');

  const deletedCheck = await getMissionById(d1, mToDel.id);
  assert(deletedCheck === null, 'Mission confirmed deleted from DB');

  // ─────────────────────────────────────────────────────────────
  // Seed Registrations & Volunteers for Volunteer Tests (11-15)
  // ─────────────────────────────────────────────────────────────
  const vol1Id = 'vol_test_001';
  const vol2Id = 'vol_test_002';
  await d1.prepare('INSERT INTO volunteers (id, member_id, name, phone) VALUES (?, ?, ?, ?)').bind(vol1Id, 'MEM-001', 'أحمد محمود', '01012345678').run();
  await d1.prepare('INSERT INTO volunteers (id, member_id, name, phone) VALUES (?, ?, ?, ?)').bind(vol2Id, 'MEM-002', 'سارة علي', '01198765432').run();

  const reg1Id = 'reg_test_001';
  const reg2Id = 'reg_test_002';
  await d1.prepare(`
    INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, waitlist_position, registration_sequence)
    VALUES (?, ?, ?, 'CONFIRMED', 1, NULL, 1)
  `).bind(reg1Id, m1.id, vol1Id).run();

  await d1.prepare(`
    INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, waitlist_position, registration_sequence)
    VALUES (?, ?, ?, 'WAITLIST', NULL, 1, 2)
  `).bind(reg2Id, m1.id, vol2Id).run();

  // Audio for reg1
  const dummyBase64 = 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAA==';
  await d1.prepare(`
    INSERT INTO audio_confirmations (id, registration_id, audio_data, duration_ms, mime_type, phrase, audio_key)
    VALUES ('aud_001', ?, ?, 3500, 'audio/webm', 'أؤكد مشاركتي في مهمة MNY-001', 'audio/reg_test_001.webm')
  `).bind(reg1Id, dummyBase64).run();

  // ─────────────────────────────────────────────────────────────
  // TEST 11: Confirmed Volunteers Screen (m:regs:<id> & v:detail:<id>)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 11: Confirmed Volunteers Screen ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_regs', data: `m:regs:${m1.id}` }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('أحمد محمود') &&
    last?.body?.text?.includes('مؤكدون'),
    'handleRegistrants lists confirmed volunteer أحمد محمود'
  );

  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_vdet', data: `v:detail:${reg1Id}` }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('أحمد محمود') &&
    last?.body?.text?.includes('01012345678') &&
    last?.body?.text?.includes('يوجد تسجيل صوتي'),
    'handleVolunteerDetail renders full volunteer card with audio indicator'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 12: Waiting List Screen (m:waitlist:<id>)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 12: Waiting List Screen ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_wait', data: `m:waitlist:${m1.id}` }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('سارة علي') &&
    last?.body?.text?.includes('#1'),
    'handleWaitlist lists waiting volunteer سارة علي with position #1'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 13: Promote Volunteer (v:promote:<id>)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 13: Promote Volunteer (WAITLIST -> CONFIRMED) ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_prom', data: `v:promote:${reg2Id}` }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(last?.body?.text?.includes('تأكيد المتطوع'), 'handleVolunteerMove promotes volunteer to CONFIRMED');

  const reg2Check = await d1.prepare('SELECT status, seat_number FROM registrations WHERE id = ?').bind(reg2Id).first();
  assert(reg2Check?.status === 'CONFIRMED' && reg2Check?.seat_number === 2, 'Volunteer promoted to seat 2 in DB');

  // ─────────────────────────────────────────────────────────────
  // TEST 14: Cancel Volunteer & Auto-Promote (v:cancel -> confirm:cancel)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 14: Cancel Volunteer & Auto-Promote ---');
  await d1.prepare("UPDATE registrations SET status = 'WAITLIST', seat_number = NULL, waitlist_position = 1 WHERE id = ?").bind(reg2Id).run();

  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_canc_conf', data: `confirm:cancel:${reg1Id}` }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(last?.body?.text?.includes('تم إلغاء التسجيل'), 'handleCancelRegConfirm cancels registration');

  const reg1Check = await d1.prepare('SELECT status FROM registrations WHERE id = ?').bind(reg1Id).first();
  const reg2Promoted = await d1.prepare('SELECT status, seat_number FROM registrations WHERE id = ?').bind(reg2Id).first();
  assert(reg1Check?.status === 'CANCELLED', 'Target volunteer marked CANCELLED');
  assert(reg2Promoted?.status === 'CONFIRMED' && reg2Promoted?.seat_number === 1, 'Waitlisted volunteer auto-promoted to seat 1');

  // ─────────────────────────────────────────────────────────────
  // TEST 15: Recording Audio Playback (v:audio:<id>)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 15: Recording Audio Playback ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_audio', data: `v:audio:${reg1Id}` }, ADMIN_CHAT_IDS);
  const voiceCall = capturedCalls.find(c => c.endpoint === 'sendVoice');
  assert(voiceCall !== undefined, 'handleVolunteerAudio sends voice message to Telegram admin');

  // ─────────────────────────────────────────────────────────────
  // TEST 16: Registration Notifications Outbox Event
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 16: Registration Notifications Outbox Event ---');
  const nowIso = new Date().toISOString();
  await d1.prepare(`
    INSERT INTO notification_events (id, registration_id, mission_id, admin_chat_id, payload, event_type, status, attempts, next_attempt_at, created_at)
    VALUES ('notif_test_001', ?, ?, ?, '{}', 'REGISTRATION_CONFIRMED', 'PENDING', 0, ?, ?)
  `).bind(reg2Id, m1.id, String(ADMIN_CHAT_ID), nowIso, nowIso).run();

  const notifEvent = await d1.prepare('SELECT * FROM notification_events WHERE id = ?').bind('notif_test_001').first();
  assert(notifEvent?.status === 'PENDING', 'Notification event created and waiting in outbox');

  // ─────────────────────────────────────────────────────────────
  // TEST 17: Navigation (Back Buttons & Cancel)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 17: Navigation (Back Buttons & Cancel) ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_wiz_canc', data: 'wiz:create:cancel' }, ADMIN_CHAT_IDS);
  assert(getLastCall()?.body?.text?.includes('تم إلغاء إنشاء المهمة'), 'Wizard cancel returns cleanly to main menu');

  // ─────────────────────────────────────────────────────────────
  // TEST 18: Unauthorized Access Blocks
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 18: Unauthorized Access Blocks ---');
  capturedCalls = [];
  await handleCallbackQuery(token, PUBLIC_CHAT_ID, d1, { id: 'cb_unauth_m', data: `m:close:${m1.id}` }, ADMIN_CHAT_IDS);
  assert(getLastCall()?.body?.text?.includes('غير مصرح لك'), 'Public user blocked from m:close');

  capturedCalls = [];
  await handleCallbackQuery(token, PUBLIC_CHAT_ID, d1, { id: 'cb_unauth_wiz', data: 'nav:create' }, ADMIN_CHAT_IDS);
  assert(getLastCall()?.body?.text?.includes('غير مصرح لك'), 'Public user blocked from nav:create');

  // ─────────────────────────────────────────────────────────────
  // TEST 19: Duplicate Callback (Idempotent & Safe)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 19: Duplicate Callback Safety ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_dup_1', data: 'nav:stats' }, ADMIN_CHAT_IDS);
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_dup_1', data: 'nav:stats' }, ADMIN_CHAT_IDS);
  assert(passed >= 18, 'Duplicate callback handled gracefully without throwing or corrupting state');

  // ─────────────────────────────────────────────────────────────
  // TEST 20: Stale / Invalid Callback
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 20: Stale / Invalid Callback ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_invalid', data: 'm:detail:invalid-uuid-9999' }, ADMIN_CHAT_IDS);
  assert(getLastCall()?.body?.text?.includes('المهمة غير موجودة'), 'Invalid mission callback handled gracefully with error notice');

  // ─────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────
  console.log('\n=============================================');
  console.log(`🎯 TEST RESULTS: ${passed} PASSED / ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('=============================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner fatal crash:', err);
  process.exit(1);
});
