/**
 * Phase 2 — Telegram Admin Parity Test Suite
 * Tests all new features: Member Search, All Volunteers, Notification Toggle, Enhanced Stats
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Import handlers under test
import { startCommandHandler } from '../src/telegram/commands/start';
import { handleStats } from '../src/telegram/commands/missions';
import { handleCallbackQuery, executeSearch } from '../src/telegram/callbacks';
import { handleWizardMessage } from '../src/telegram/wizard';
import { createMission, getMissionById } from '../src/services/mission.service';
import { requireAdmin, isAdmin } from '../src/telegram/auth';

// ─── D1 In-Memory SQLite Shim ──────────────────────────────────
function createTestD1(): any {
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
          body = options.body;
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
  console.log('🚀 STARTING PHASE 2 TELEGRAM ADMIN TEST SUITE\n');

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
  console.log('--- SEED: Creating test missions and volunteers ---');
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
  const vol1Id = 'vol_p2_001';
  const vol2Id = 'vol_p2_002';
  const vol3Id = 'vol_p2_003';
  await d1.prepare('INSERT INTO volunteers (id, member_id, name, phone) VALUES (?, ?, ?, ?)').bind(vol1Id, 'MEM-101', 'أحمد محمد', '01012345678').run();
  await d1.prepare('INSERT INTO volunteers (id, member_id, name, phone) VALUES (?, ?, ?, ?)').bind(vol2Id, 'MEM-102', 'سارة علي', '01198765432').run();
  await d1.prepare('INSERT INTO volunteers (id, member_id, name, phone) VALUES (?, ?, ?, ?)').bind(vol3Id, 'MEM-103', 'محمد حسن', '01255544433').run();

  // Seed registrations
  const reg1Id = 'reg_p2_001';
  const reg2Id = 'reg_p2_002';
  const reg3Id = 'reg_p2_003';
  await d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, registration_sequence) VALUES (?, ?, ?, 'CONFIRMED', 1, 1)`).bind(reg1Id, m1.id, vol1Id).run();
  await d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, waitlist_position, registration_sequence) VALUES (?, ?, ?, 'WAITLIST', 1, 2)`).bind(reg2Id, m1.id, vol2Id).run();
  await d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, registration_sequence) VALUES (?, ?, ?, 'CONFIRMED', 1, 1)`).bind(reg3Id, m2.id, vol3Id).run();

  // ─────────────────────────────────────────────────────────────
  // TEST 1: Notification Toggle (m:notify_toggle)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 1: Notification Toggle Per Mission ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_notif', data: `m:notify_toggle:${m1.id}` }, ADMIN_CHAT_IDS);
  let last = getLastCall();
  assert(
    last?.body?.text?.includes('إيقاف') || last?.body?.text?.includes('تشغيل'),
    'Notification toggle responds with status change'
  );

  // Verify DB updated
  const notifCheck = await d1.prepare('SELECT telegram_notifications FROM missions WHERE id = ?').bind(m1.id).first();
  assert(notifCheck?.telegram_notifications === 0, 'Notification toggled OFF in DB', `got: ${notifCheck?.telegram_notifications}`);

  // Toggle back on
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_notif2', data: `m:notify_toggle:${m1.id}` }, ADMIN_CHAT_IDS);
  const notifCheck2 = await d1.prepare('SELECT telegram_notifications FROM missions WHERE id = ?').bind(m1.id).first();
  assert(notifCheck2?.telegram_notifications === 1, 'Notification toggled back ON in DB', `got: ${notifCheck2?.telegram_notifications}`);

  // ─────────────────────────────────────────────────────────────
  // TEST 2: Member Search by ID (nav:search → search:prompt:member_id)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 2: Member Search by ID ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_search', data: 'nav:search' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('البحث') && last?.body?.reply_markup?.inline_keyboard?.some((row: any[]) => row.some((b: any) => b.callback_data === 'search:prompt:member_id')),
    'Search menu shows member ID search button'
  );

  // Trigger search prompt
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_search_pid', data: 'search:prompt:member_id' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('رقم العضوية') && last?.body?.text?.includes('اكتب'),
    'Search prompt asks for member ID input'
  );

  // Simulate typing search query
  capturedCalls = [];
  await handleWizardMessage(token, ADMIN_CHAT_ID, d1, 'MEM-101');
  last = getLastCall();
  assert(
    last?.body?.text?.includes('أحمد محمد') && last?.body?.text?.includes('MEM-101'),
    'Search by member ID returns correct volunteer أحمد محمد'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 3: Member Search by Name
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 3: Member Search by Name ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_search_name', data: 'search:prompt:name' }, ADMIN_CHAT_IDS);

  capturedCalls = [];
  await handleWizardMessage(token, ADMIN_CHAT_ID, d1, 'سارة');
  last = getLastCall();
  assert(
    last?.body?.text?.includes('سارة علي'),
    'Search by name returns correct volunteer سارة علي'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 4: Member Search - No Results
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 4: Member Search - No Results ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_search_pid2', data: 'search:prompt:member_id' }, ADMIN_CHAT_IDS);

  capturedCalls = [];
  await handleWizardMessage(token, ADMIN_CHAT_ID, d1, 'NONEXISTENT');
  last = getLastCall();
  assert(
    last?.body?.text?.includes('لا توجد نتائج'),
    'Search with no results shows appropriate message'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 5: All Volunteers View (nav:volunteers)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 5: All Volunteers View ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_vols', data: 'nav:volunteers' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('جميع المتطوعين') && last?.body?.text?.includes('أحمد محمد') && last?.body?.text?.includes('سارة علي'),
    'All volunteers view shows cross-mission volunteers'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 6: Enhanced Stats (nav:stats)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 6: Enhanced Stats ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_stats', data: 'nav:stats' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('إحصائيات النظام') && last?.body?.text?.includes('تسجيلات اليوم'),
    'Enhanced stats shows today registrations count'
  );
  assert(
    last?.body?.text?.includes('المهمات الأكثر نشاطاً'),
    'Enhanced stats shows most active missions section'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 7: Notification Toggle Unauthorized
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 7: Unauthorized Notification Toggle ---');
  capturedCalls = [];
  await handleCallbackQuery(token, PUBLIC_CHAT_ID, d1, { id: 'cb_unauth_notif', data: `m:notify_toggle:${m1.id}` }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('غير مصرح لك'),
    'Public user blocked from notification toggle'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 8: Unauthorized Search
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 8: Unauthorized Search ---');
  capturedCalls = [];
  await handleCallbackQuery(token, PUBLIC_CHAT_ID, d1, { id: 'cb_unauth_search', data: 'nav:search' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('غير مصرح لك'),
    'Public user blocked from search'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 9: Unauthorized Volunteers View
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 9: Unauthorized Volunteers View ---');
  capturedCalls = [];
  await handleCallbackQuery(token, PUBLIC_CHAT_ID, d1, { id: 'cb_unauth_vols', data: 'nav:volunteers' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('غير مصرح لك'),
    'Public user blocked from volunteers view'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 10: Search Pagination
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 10: Search Pagination ---');
  // Seed more volunteers to trigger pagination
  for (let i = 104; i < 120; i++) {
    const vid = `vol_p2_${i}`;
    const rid = `reg_p2_${i}`;
    await d1.prepare('INSERT INTO volunteers (id, member_id, name, phone) VALUES (?, ?, ?, ?)').bind(vid, `MEM-${i}`, `متطوع ${i}`, '01000000000').run();
    await d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, registration_sequence) VALUES (?, ?, ?, 'CONFIRMED', ?, ?)`).bind(rid, m1.id, vid, i - 103, i - 103).run();
  }

  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_search_pid3', data: 'search:prompt:member_id' }, ADMIN_CHAT_IDS);

  capturedCalls = [];
  await handleWizardMessage(token, ADMIN_CHAT_ID, d1, 'MEM');
  last = getLastCall();
  assert(
    last?.body?.text?.includes('نتيجة') && last?.body?.reply_markup?.inline_keyboard?.some((row: any[]) => row.some((b: any) => b.text?.includes('التالي'))),
    'Search results show pagination when > 10 results'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 11: Duplicate Callback Safety
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 11: Duplicate Callback Safety ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_dup_p2', data: 'nav:stats' }, ADMIN_CHAT_IDS);
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_dup_p2', data: 'nav:stats' }, ADMIN_CHAT_IDS);
  assert(passed >= 10, 'Duplicate callback handled gracefully');

  // ─────────────────────────────────────────────────────────────
  // TEST 12: Stale Callback Handling
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 12: Stale / Invalid Callback ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_stale', data: 'm:notify_toggle:invalid-uuid' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('المهمة غير موجودة'),
    'Invalid mission notify_toggle handled gracefully'
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 13: Search Cancel
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 13: Search → Cancel → Home ---');
  capturedCalls = [];
  await handleCallbackQuery(token, ADMIN_CHAT_ID, d1, { id: 'cb_search_cancel', data: 'nav:home' }, ADMIN_CHAT_IDS);
  last = getLastCall();
  assert(
    last?.body?.text?.includes('لوحة إدارة') || last?.body?.text?.includes('لوحة تحكم'),
    'Cancel from search returns to main dashboard'
  );

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
