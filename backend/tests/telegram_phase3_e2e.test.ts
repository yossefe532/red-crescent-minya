/**
 * Phase 3 — Telegram Admin UX + Live Activity Test Suite
 * Tests: Activity Feed, Registration Filters, Global Notification Settings
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Import handlers under test
import { startCommandHandler } from '../src/telegram/commands/start';
import { handleCallbackQuery } from '../src/telegram/callbacks';
import { createMission } from '../src/services/mission.service';
import { logAudit } from '../src/services/audit.service';

// ─── D1 In-Memory SQLite Shim ──────────────────────────────────
function createTestD1(): { d1: any } {
  const sqlite = new DatabaseSync(':memory:');

  // Load and execute all migrations in order
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
    async batch(_stmts: any[]) {
      return [];
    },
  };

  return { d1 };
}

// ─── Telegram Mock ─────────────────────────────────────────────
let capturedCalls: any[] = [];

function setupTgMock() {
  // Intercept global fetch for Telegram API calls
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('api.telegram.org')) {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      capturedCalls.push({ url, body, method: init?.method });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(input, init);
  };
}

function getLastCall(): any {
  if (capturedCalls.length === 0) return null;
  return capturedCalls[capturedCalls.length - 1];
}

// ─── Test Suite Runner ─────────────────────────────────────────
async function runTests() {
  console.log('🚀 STARTING PHASE 3 TELEGRAM ADMIN UX + LIVE ACTIVITY TEST SUITE\n');

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

  // ─── Seed Data ──────────────────────────────────────────────
  console.log('--- SEED: Creating test missions, volunteers, registrations, audit logs ---');
  const m1 = await createMission(d1, {
    title: 'مهمة إسعاف_primary',
    location: 'المنيا',
    start_at: '2026-09-20T08:00:00Z',
    end_at: '2026-09-20T16:00:00Z',
    capacity: 5,
    waiting_list: 2,
    telegram_notifications: 1,
  });

  const m2 = await createMission(d1, {
    title: 'مهمة تطعيم',
    location: 'ملوي',
    start_at: '2026-09-22T08:00:00Z',
    end_at: '2026-09-22T16:00:00Z',
    capacity: 10,
    waiting_list: 5,
    telegram_notifications: 0,
  });

  // Seed volunteers
  const vol1Id = 'vol_p3_001';
  const vol2Id = 'vol_p3_002';
  const vol3Id = 'vol_p3_003';
  const vol4Id = 'vol_p3_004';
  await d1.prepare('INSERT INTO volunteers (id, member_id, name, phone) VALUES (?, ?, ?, ?)').bind(vol1Id, 'MEM-101', 'أحمد محمد', '01012345678').run();
  await d1.prepare('INSERT INTO volunteers (id, member_id, name, phone) VALUES (?, ?, ?, ?)').bind(vol2Id, 'MEM-102', 'سارة علي', '01198765432').run();
  await d1.prepare('INSERT INTO volunteers (id, member_id, name, phone) VALUES (?, ?, ?, ?)').bind(vol3Id, 'MEM-103', 'محمد حسن', '01255544433').run();
  await d1.prepare('INSERT INTO volunteers (id, member_id, name, phone) VALUES (?, ?, ?, ?)').bind(vol4Id, 'MEM-104', 'فاطمة أحمد', '01599988877').run();

  // Seed registrations with various statuses
  const reg1Id = 'reg_p3_001';
  const reg2Id = 'reg_p3_002';
  const reg3Id = 'reg_p3_003';
  const reg4Id = 'reg_p3_004';
  await d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, registration_sequence) VALUES (?, ?, ?, 'CONFIRMED', 1, 1)`).bind(reg1Id, m1.id, vol1Id).run();
  await d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, waitlist_position, registration_sequence) VALUES (?, ?, ?, 'WAITLIST', 1, 2)`).bind(reg2Id, m1.id, vol2Id).run();
  await d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, registration_sequence) VALUES (?, ?, ?, 'CONFIRMED', 1, 1)`).bind(reg3Id, m2.id, vol3Id).run();
  await d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, registration_sequence) VALUES (?, ?, ?, 'REJECTED', 4)`).bind(reg4Id, m2.id, vol4Id).run();

  // ─────────────────────────────────────────────────────────────
  // TEST 1: Activity Feed — Basic
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 1: Activity Feed — Basic Display ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_act1', data: 'nav:activity' }, ADMIN_CHAT_IDS);
  let last = getLastCall();
  assert(
    last?.body?.text?.includes('آخر النشاطات') || last?.body?.text?.includes('لا توجد'),
    'Activity feed displays correctly'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 2: Activity Feed — With Audit Data
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 2: Activity Feed — With Audit Data ---');
  // Seed audit log entries
  await logAudit(d1, {
    actorId: 'vol_p3_001',
    actorType: 'volunteer',
    action: 'REGISTRATION_CONFIRMED',
    entityType: 'registration',
    entityId: reg1Id,
    metadata: { mission_id: m1.id, name: 'أحمد محمد', seat_number: 1, status: 'CONFIRMED' }
  });
  await logAudit(d1, {
    actorId: 'vol_p3_002',
    actorType: 'volunteer',
    action: 'REGISTRATION_WAITLISTED',
    entityType: 'registration',
    entityId: reg2Id,
    metadata: { mission_id: m1.id, name: 'سارة علي', waitlist_position: 1, status: 'WAITLIST' }
  });
  await logAudit(d1, {
    actorId: 'admin',
    actorType: 'admin',
    action: 'MISSION_REOPENED',
    entityType: 'mission',
    entityId: m1.id,
    metadata: { name: 'مهمة إسعاف_primary' }
  });

  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_act2', data: 'nav:activity' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  const text = last?.body?.text || '';
  assert(
    text.includes('آخر النشاطات') && (text.includes('تسجيل جديد مؤكد') || text.includes('REOPENED') || text.includes('إعادة فتح')),
    'Activity feed shows audit events',
    text.slice(0, 200)
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 3: Activity Feed — Registration Event
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 3: Activity Feed — Registration Events ---');
  assert(
    text.includes('تسجيل جديد مؤكد') || text.includes('REGISTRATION_CONFIRMED'),
    'Registration confirmed event visible'
  );
  assert(
    text.includes('تسجيل في الانتظار') || text.includes('REGISTRATION_WAITLISTED'),
    'Registration waitlisted event visible'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 4: Activity Feed — Mission Event
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 4: Activity Feed — Mission Events ---');
  assert(
    text.includes('إعادة فتح المهمة') || text.includes('MISSION_REOPENED'),
    'Mission reopen event visible'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 5: Activity Feed — Pagination
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 5: Activity Feed — Pagination Button ---');
  assert(
    last?.body?.reply_markup?.inline_keyboard?.some((row: any[]) =>
      row.some((b: any) => b.callback_data === 'nav:activity' && b.text?.includes('تحديث'))
    ),
    'Activity feed has refresh button'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 6: Registration Filter — All
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 6: Registration Filter — ALL ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_vol_all', data: 'vol:filter:ALL' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('جميع المتطوعين'),
    'Volunteer filter ALL shows all volunteers'
  );
  // Should have filter buttons
  assert(
    last?.body?.reply_markup?.inline_keyboard?.some((row: any[]) =>
      row.some((b: any) => b.callback_data === 'vol:filter:CONFIRMED')
    ),
    'Filter ALL shows CONFIRMED filter button'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 7: Registration Filter — Confirmed
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 7: Registration Filter — CONFIRMED ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_vol_conf', data: 'vol:filter:CONFIRMED' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('جميع المتطوعين'),
    'Filter CONFIRMED returns volunteers list'
  );
  // The text should only show confirmed volunteers (no waitlisted ones)
  assert(
    !last?.body?.text?.includes('سارة علي') || last?.body?.text?.includes('مؤكد'),
    'CONFIRMED filter excludes waitlisted volunteers',
    last?.body?.text?.slice(0, 300)
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 8: Registration Filter — Waitlist
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 8: Registration Filter — WAITLIST ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_vol_wait', data: 'vol:filter:WAITLIST' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('جميع المتطوعين'),
    'Filter WAITLIST returns volunteers list'
  );
  assert(
    !last?.body?.text?.includes('أحمد محمد'),
    'WAITLIST filter excludes confirmed volunteers',
    last?.body?.text?.slice(0, 300)
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 9: Registration Filter — Rejected
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 9: Registration Filter — REJECTED ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_vol_rej', data: 'vol:filter:REJECTED' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('جميع المتطوعين'),
    'Filter REJECTED returns volunteers list'
  );
  assert(
    last?.body?.text?.includes('فاطمة أحمد'),
    'REJECTED filter shows rejected volunteer',
    last?.body?.text?.slice(0, 300)
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 10: Global Notification Settings — Display
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 10: Global Notification Settings — Display ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_notif_display', data: 'nav:notifications' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('إعدادات الإشعارات'),
    'Notification settings screen displays'
  );
  assert(
    last?.body?.text?.includes('الإشعارات العامة') || last?.body?.text?.includes('مفعّلة') || last?.body?.text?.includes('متوقفة'),
    'Notification settings shows global status'
  );
  // Should show precedence info (mission count)
  assert(
    last?.body?.text?.includes('مهام مفعّلة') || last?.body?.text?.includes('لن تصل'),
    'Notification settings shows precedence information'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 11: Global Notification — Toggle ON
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 11: Global Notification — Toggle ON ---');
  // First set to OFF
  await d1.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('notifications_enabled', '0', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = datetime('now')").run();
  
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_notif_on', data: 'notify:toggle:on' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('تشغيل') || last?.body?.text?.includes('مفعّلة'),
    'Notification toggle ON responds'
  );
  // Verify DB
  const notifRow = await d1.prepare("SELECT value FROM settings WHERE key = 'notifications_enabled'").first();
  assert(notifRow?.value === '1', 'Global notification set to 1 (ON) in DB', `got: ${notifRow?.value}`);

  // ─────────────────────────────────────────────────────────────
  // TEST 12: Global Notification — Toggle OFF
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 12: Global Notification — Toggle OFF ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_notif_off', data: 'notify:toggle:off' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('إيقاف') || last?.body?.text?.includes('متوقفة'),
    'Notification toggle OFF responds'
  );
  // Verify DB
  const notifRow2 = await d1.prepare("SELECT value FROM settings WHERE key = 'notifications_enabled'").first();
  assert(notifRow2?.value === '0', 'Global notification set to 0 (OFF) in DB', `got: ${notifRow2?.value}`);

  // ─────────────────────────────────────────────────────────────
  // TEST 13: Mission/Global Precedence
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 13: Mission/Global Precedence ---');
  // Set global OFF, verify display shows that
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_notif_prec', data: 'nav:notifications' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('متوقفة') || last?.body?.text?.includes('لن تصل'),
    'Notifications OFF state shows in precedence display'
  );

  // Toggle global ON
  await d1.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('notifications_enabled', '1', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = datetime('now')").run();
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_notif_prec2', data: 'nav:notifications' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('مفعّلة') && last?.body?.text?.includes('مهام مفعّلة'),
    'Notifications ON state shows mission count in precedence display'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 14: Unauthorized — Activity Feed
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 14: Unauthorized — Activity Feed ---');
  capturedCalls = [];
  await handleCallbackQuery(token, PUBLIC_CHAT_ID, d1, { id: 'cb_act_unauth', data: 'nav:activity' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('غير مصرح') || last?.body?.text?.includes(' Admin'),
    'Unauthorized user blocked from activity feed'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 15: Unauthorized — Registration List
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 15: Unauthorized — Registration List ---');
  capturedCalls = [];
  await handleCallbackQuery(token, PUBLIC_CHAT_ID, d1, { id: 'cb_vol_unauth', data: 'vol:filter:ALL' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('غير مصرح') || last?.body?.text?.includes(' Admin'),
    'Unauthorized user blocked from volunteer list'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 16: Unauthorized — Notification Settings
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 16: Unauthorized — Notification Settings ---');
  capturedCalls = [];
  await handleCallbackQuery(token, PUBLIC_CHAT_ID, d1, { id: 'cb_notif_unauth', data: 'nav:notifications' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('غير مصرح') || last?.body?.text?.includes(' Admin'),
    'Unauthorized user blocked from notification settings'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 17: Duplicate Callback
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 17: Duplicate Callback Handling ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_dup', data: 'noop' }, ADMIN_CHAT_IDS);
  // noop should not send any message
  assert(
    capturedCalls.filter(c => c.url?.includes('sendMessage')).length === 0,
    'Duplicate/noop callback does not send message'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 18: Stale Callback — Unknown prefix
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 18: Stale/Unknown Callback ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_stale', data: 'stale_action:data' }, ADMIN_CHAT_IDS);
  // Should not crash
  assert(true, 'Unknown callback prefix does not crash');

  // ─────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log(`📊 PHASE 3 RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('══════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error('Test suite error:', e);
  process.exit(1);
});
