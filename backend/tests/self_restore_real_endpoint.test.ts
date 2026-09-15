/**
 * SELF-RESTORE — REAL HTTP ENDPOINT INTEGRATION TEST
 *
 * Tests the ACTUAL Hono route (self-cancel.ts) via app.request() over HTTP,
 * with real bindings (DB), NOT an inline copy of the logic.
 *
 * Covers the security/ownership/state/capacity audit requirements:
 *   1. Restore to WAITLIST when no seat but waitlist has room (regression — catches the waiting_list SELECT bug)
 *   2. Restore rejected when waitlist FULL
 *   3. Restore to CONFIRMED when seat available
 *   4. Restore rejected when mission CLOSED
 *   5. Unauthorized restore (wrong token / no token / guessing ID) → DENIED
 *   6. Double restore → idempotent, one logical restore
 *   7. Concurrent restore → no duplicate seat/position/corrupted counters
 */
import { Hono } from 'hono';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { selfCancelRoutes } from '../src/routes/self-cancel';
import { Env } from '../src/env';

// ─── D1 In-Memory SQLite Shim (same as other tests) ───────────
function createTestD1(): any {
  const sqlite = new DatabaseSync(':memory:');
  const migrationsDir = path.join(process.cwd(), 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f: string) => f.endsWith('.sql')).sort();
  for (const file of files) {
    sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  return {
    prepare(sql: string) {
      return {
        _sql: sql,
        _params: [] as any[],
        bind(...params: any[]) {
          this._params = params.map((p: any) => (p === undefined ? null : p));
          return this;
        },
        async first<T = any>(col?: string): Promise<T | null> {
          const stmt = sqlite.prepare(this._sql);
          const row = stmt.get(...this._params) as any;
          if (!row) return null;
          if (col) return row[col] ?? null;
          return row as T;
        },
        async all<T = any>(): Promise<{ results: T[] }> {
          const stmt = sqlite.prepare(this._sql);
          return { results: stmt.all(...this._params) as T[] };
        },
        async run(): Promise<{ success: boolean; meta: any }> {
          const stmt = sqlite.prepare(this._sql);
          const result = stmt.run(...this._params);
          return { success: true, meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
        },
      };
    },
  };
}

// ─── Test counters ─────────────────────────────────────────────
let testCount = 0;
let passCount = 0;
let failCount = 0;
function assert(condition: boolean, msg: string) {
  testCount++;
  if (condition) { passCount++; console.log(`  ✅ [PASS] ${msg}`); }
  else { failCount++; console.log(`  ❌ [FAIL] ${msg}`); }
}
function assertEqual(actual: any, expected: any, msg: string) {
  const pass = actual === expected;
  testCount++;
  if (pass) { passCount++; console.log(`  ✅ [PASS] ${msg} (got: ${actual})`); }
  else { failCount++; console.log(`  ❌ [FAIL] ${msg} — expected: ${expected}, got: ${actual}`); }
}

// ─── Seed helpers ──────────────────────────────────────────────
function seedMission(d1: any, opts?: { capacity?: number; waitingList?: number; status?: string }) {
  const capacity = opts?.capacity ?? 2;
  const waitingList = opts?.waitingList ?? 3;
  const status = opts?.status ?? 'OPEN';
  d1.prepare(`INSERT INTO missions (id, title, public_code, status, capacity, waiting_list, confirmation_phrase, start_at, end_at, registration_open_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'test-phrase', '2026-10-01T08:00:00Z', '2026-10-01T16:00:00Z', datetime('now'), 'test')`)
    .bind('mission-1', 'مهمة اختبار', 'MNY-REAL', status, capacity, waitingList).run();
}
function seedVolunteer(d1: any, id: string, name: string, memberId: string) {
  d1.prepare(`INSERT INTO volunteers (id, name, member_id, phone) VALUES (?, ?, ?, ?)`)
    .bind(id, name, memberId, `0100000000${memberId.slice(-1)}`).run();
}
function seedReg(d1: any, id: string, volId: string, status: string, opts?: { seat?: number | null; wl?: number | null; token?: string; seq?: number }) {
  const seat = opts?.seat ?? null;
  const wl = opts?.wl ?? null;
  const token = opts?.token ?? `token-${volId}`;
  const seq = opts?.seq ?? 0;
  if (seat !== null) {
    d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, waitlist_position, registration_sequence, ownership_token)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`).bind(id, 'mission-1', volId, status, seat, seq, token).run();
  } else if (wl !== null) {
    d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, waitlist_position, registration_sequence, ownership_token)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`).bind(id, 'mission-1', volId, status, wl, seq, token).run();
  } else {
    d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, waitlist_position, registration_sequence, ownership_token)
      VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`).bind(id, 'mission-1', volId, status, seq, token).run();
  }
}

// ─── Real HTTP app ─────────────────────────────────────────────
function buildApp(d1: any) {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api', selfCancelRoutes);
  const env = {
    DB: d1,
    AUDIO_BUCKET: {},
    ENVIRONMENT: 'test',
    FRONTEND_URL: 'http://localhost',
    AUDIO_RETENTION_DAYS: '30',
  } as any;
  return { app, env };
}

// Helper: restore regId as ownership token over real HTTP
async function httpRestore(app: any, env: any, regId: string, token?: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers['Cookie'] = `ownership_token=${token}`;
  const res = await app.request(`/api/registrations/${regId}/self-restore`, { method: 'POST', headers }, env);
  const body = await res.json();
  return { statusCode: res.status, body };
}

// Helper: direct DB row read
async function dbRow(d1: any, sql: string, ...params: any[]) {
  return d1.prepare(sql).bind(...params).first();
}

(async () => {
  // ═══════ TEST 1: REGRESSION — restore to WAITLIST when waitlist has room ═══════
  console.log('\n=== TEST 1: Continued restore — WAITLIST with room (real endpoint, catches waiting_list SELECT bug) ===');
  {
    const d1 = createTestD1();
    seedMission(d1, { capacity: 2, waitingList: 3 });
    seedVolunteer(d1, 'vol-1', 'أ', 'V1');
    seedVolunteer(d1, 'vol-2', 'ب', 'V2');
    seedVolunteer(d1, 'vol-3', 'ج', 'V3');
    seedVolunteer(d1, 'vol-4', 'د', 'V4');
    seedVolunteer(d1, 'vol-5', 'هـ', 'V5');
    // CONFIRMED 2/2 (seats 1,2), WAITLIST 1/3 (pos 1)
    seedReg(d1, 'reg-1', 'vol-1', 'CONFIRMED', { seat: 1, token: 'token-A', seq: 1 });
    seedReg(d1, 'reg-2', 'vol-2', 'CONFIRMED', { seat: 2, token: 'token-B', seq: 2 });
    seedReg(d1, 'reg-3', 'vol-3', 'WAITLIST', { wl: 1, token: 'token-C', seq: 3 });
    // reg-4 (vol-4) cancelled → can restore; it was CONFIRMED originally
    seedReg(d1, 'reg-4', 'vol-4', 'CANCELLED', { token: 'token-D', seq: 4 });
    d1.prepare(`UPDATE registrations SET original_status='CONFIRMED', cancelled_at=datetime('now') WHERE id='reg-4'`).run();

    const { app, env } = buildApp(d1);
    const res = await httpRestore(app, env, 'reg-4', 'token-D');

    assertEqual(res.statusCode, 200, 'restore returns 200 OK');
    assertEqual(res.body.data?.restored_status, 'WAITLIST', 'restored to WAITLIST (no seat, waitlist has room)');

    const reg4 = await dbRow(d1, `SELECT status, waitlist_position, seat_number FROM registrations WHERE id='reg-4'`);
    assertEqual(reg4.status, 'WAITLIST', 'DB: reg-4 is WAITLIST');
    assertEqual(reg4.waitlist_position, 2, 'reg-4 joins waitlist at END, position 2');
    // Existing waitlist user (reg-3) stays at position 1
    const reg3 = await dbRow(d1, `SELECT waitlist_position FROM registrations WHERE id='reg-3'`);
    assertEqual(reg3.waitlist_position, 1, 'existing waitlisted user (reg-3) remains position 1');
    // No duplicate confirmed seats
    const confirmedCount = await dbRow(d1, `SELECT COUNT(*) as c FROM registrations WHERE status='CONFIRMED'`);
    assertEqual(confirmedCount.c, 2, 'confirmed count unchanged (2)');
  }

  // ═══════ TEST 2: Restore REJECTED when waitlist FULL ═══════
  console.log('\n=== TEST 2: Restore rejected — waitlist FULL ===');
  {
    const d1 = createTestD1();
    seedMission(d1, { capacity: 2, waitingList: 3 });
    for (let i = 1; i <= 6; i++) seedVolunteer(d1, `vol-${i}`, `م${i}`, `V${i}`);
    // CONFIRMED 2/2, WAITLIST 3/3 (full)
    seedReg(d1, 'reg-1', 'vol-1', 'CONFIRMED', { seat: 1, token: 't1', seq: 1 });
    seedReg(d1, 'reg-2', 'vol-2', 'CONFIRMED', { seat: 2, token: 't2', seq: 2 });
    seedReg(d1, 'reg-3', 'vol-3', 'WAITLIST', { wl: 1, token: 't3', seq: 3 });
    seedReg(d1, 'reg-4', 'vol-4', 'WAITLIST', { wl: 2, token: 't4', seq: 4 });
    seedReg(d1, 'reg-5', 'vol-5', 'WAITLIST', { wl: 3, token: 't5', seq: 5 });
    seedReg(d1, 'reg-6', 'vol-6', 'CANCELLED', { token: 't6', seq: 6 });
    d1.prepare(`UPDATE registrations SET original_status='CONFIRMED', cancelled_at=datetime('now') WHERE id='reg-6'`).run();

    const { app, env } = buildApp(d1);
    const res = await httpRestore(app, env, 'reg-6', 't6');

    assertEqual(res.statusCode, 409, 'restore returns 409 CONFLICT when both seats and waitlist full');
    assert(res.body.error?.message?.includes('ممتلئ'), `error mentions full: "${res.body.error?.message}"`);
    // No duplicate / corruption
    const reg6 = await dbRow(d1, `SELECT status FROM registrations WHERE id='reg-6'`);
    assertEqual(reg6.status, 'CANCELLED', 'reg-6 remains CANCELLED (no duplicate)');
    const wlCount = await dbRow(d1, `SELECT COUNT(*) as c FROM registrations WHERE status='WAITLIST'`);
    assertEqual(wlCount.c, 3, 'waitlist count unchanged (3, no position 4)');
  }

  // ═══════ TEST 3: Restore to CONFIRMED when seat available ═══════
  console.log('\n=== TEST 3: Restore to CONFIRMED with free seat ===');
  {
    const d1 = createTestD1();
    seedMission(d1, { capacity: 3, waitingList: 2 });
    seedVolunteer(d1, 'vol-1', 'أ', 'V1');
    seedVolunteer(d1, 'vol-2', 'ب', 'V2');
    seedVolunteer(d1, 'vol-3', 'ج', 'V3');
    // CONFIRMED 1/3 (seat 1), so seat 2 is free
    seedReg(d1, 'reg-1', 'vol-1', 'CONFIRMED', { seat: 1, token: 't1', seq: 1 });
    seedReg(d1, 'reg-2', 'vol-2', 'CONFIRMED', { seat: 2, token: 't2', seq: 2 });
    seedReg(d1, 'reg-3', 'vol-3', 'CANCELLED', { token: 't3', seq: 3 });
    d1.prepare(`UPDATE registrations SET original_status='CONFIRMED', cancelled_at=datetime('now') WHERE id='reg-3'`).run();

    const { app, env } = buildApp(d1);
    const res = await httpRestore(app, env, 'reg-3', 't3');

    assertEqual(res.statusCode, 200, 'restore returns 200 OK');
    assertEqual(res.body.data?.restored_status, 'CONFIRMED', 'restored to CONFIRMED');
    const reg3 = await dbRow(d1, `SELECT status, seat_number FROM registrations WHERE id='reg-3'`);
    assertEqual(reg3.status, 'CONFIRMED', 'DB: reg-3 CONFIRMED');
    assert(reg3.seat_number !== null && reg3.seat_number >= 1 && reg3.seat_number <= 3, `valid seat assigned (#${reg3.seat_number})`);
  }

  // ═══════ TEST 4: Restore rejected when mission CLOSED ═══════
  console.log('\n=== TEST 4: Restore rejected — mission CLOSED ===');
  {
    const d1 = createTestD1();
    seedMission(d1, { capacity: 2, waitingList: 2, status: 'CLOSED' });
    seedVolunteer(d1, 'vol-1', 'أ', 'V1');
    seedReg(d1, 'reg-1', 'vol-1', 'CANCELLED', { token: 't1', seq: 1 });
    d1.prepare(`UPDATE registrations SET original_status='CONFIRMED', cancelled_at=datetime('now') WHERE id='reg-1'`).run();

    const { app, env } = buildApp(d1);
    const res = await httpRestore(app, env, 'reg-1', 't1');
    assertEqual(res.statusCode, 409, 'restore returns 409 for CLOSED mission');
    assert(res.body.error?.message?.includes('مغلقة'), `error mentions closed: "${res.body.error?.message}"`);
  }

  // ═══════ TEST 5: Unauthorized restore — wrong token / no token / guessing ID ═══════
  console.log('\n=== TEST 5: Unauthorized restore DENIED ===');
  {
    const d1 = createTestD1();
    seedMission(d1, { capacity: 2, waitingList: 2 });
    seedVolunteer(d1, 'vol-1', 'أ', 'V1');
    seedVolunteer(d1, 'vol-2', 'ب', 'V2');
    seedReg(d1, 'reg-A', 'vol-1', 'CANCELLED', { token: 'token-A', seq: 1 });
    seedReg(d1, 'reg-B', 'vol-2', 'CANCELLED', { token: 'token-B', seq: 2 });
    d1.prepare(`UPDATE registrations SET original_status='CONFIRMED', cancelled_at=datetime('now') WHERE id IN ('reg-A','reg-B')`).run();

    const { app, env } = buildApp(d1);

    // (a) User A restores own A → OK
    const okA = await httpRestore(app, env, 'reg-A', 'token-A');
    assertEqual(okA.statusCode, 200, 'User A restores own A → 200');
    // (b) User A cannot restore B
    const badB = await httpRestore(app, env, 'reg-B', 'token-A');
    assertEqual(badB.statusCode, 403, 'User A restoring B (wrong token) → 403 FORBIDDEN');
    // (c) User B cannot restore A
    const badA = await httpRestore(app, env, 'reg-A', 'token-B');
    assertEqual(badA.statusCode, 403, 'User B restoring A (wrong token) → 403 FORBIDDEN');
    // (d) Missing token → DENIED (no Cookie header sent → 401 unauthorized)
    const noTok = await httpRestore(app, env, 'reg-B');
    assert(noTok.statusCode === 401, `missing token → 401 UNAUTHORIZED (got: ${noTok.statusCode})`);
    // (e) Guessing another registration ID (nonexistent) → 404
    const guess = await httpRestore(app, env, 'reg-NONEXISTENT', 'token-A');
    assertEqual(guess.statusCode, 404, 'guessing unknown registration ID → 404 NOT_FOUND');
    // B was never touched by A
    const regB = await dbRow(d1, `SELECT status FROM registrations WHERE id='reg-B'`);
    assertEqual(regB.status, 'CANCELLED', 'reg-B untouched by unauthorized attempts');
  }

  // ═══════ TEST 6: Double restore — idempotent, one logical restore ═══════
  console.log('\n=== TEST 6: Double restore (idempotent) ===');
  {
    const d1 = createTestD1();
    seedMission(d1, { capacity: 3, waitingList: 2 });
    seedVolunteer(d1, 'vol-1', 'أ', 'V1');
    seedVolunteer(d1, 'vol-2', 'ب', 'V2');
    seedReg(d1, 'reg-1', 'vol-1', 'CONFIRMED', { seat: 1, token: 't1', seq: 1 });
    seedReg(d1, 'reg-2', 'vol-2', 'CANCELLED', { token: 't2', seq: 2 });
    d1.prepare(`UPDATE registrations SET original_status='WAITLIST', cancelled_at=datetime('now') WHERE id='reg-2'`).run();

    const { app, env } = buildApp(d1);
    const r1 = await httpRestore(app, env, 'reg-2', 't2');
    assertEqual(r1.statusCode, 200, 'first restore → 200');
    assertEqual(r1.body.data?.restored_status, 'CONFIRMED', 'first restore → CONFIRMED (seat free)');
    const r2 = await httpRestore(app, env, 'reg-2', 't2');
    assertEqual(r2.statusCode, 200, 'second (double) restore → 200 (idempotent, not error)');
    assertEqual(r2.body.data?.restored_status, 'CONFIRMED', 'second restore returns current state CONFIRMED');
    // No duplicate registration records
    const count = await dbRow(d1, `SELECT COUNT(*) as c FROM registrations WHERE id='reg-2'`);
    assertEqual(count.c, 1, 'single row for reg-2 (no duplicate)');
    const confirmedCount = await dbRow(d1, `SELECT COUNT(*) as c FROM registrations WHERE status='CONFIRMED'`);
    assertEqual(confirmedCount.c, 2, '2 CONFIRMED total (reg-1, reg-2) — one seat per person');
  }

  // ═══════ TEST 7: Concurrent restore — no duplicate seat/position/counters ═══════
  console.log('\n=== TEST 7: Concurrent restore (sequential simulation of two racing requests) ===');
  {
    const d1 = createTestD1();
    seedMission(d1, { capacity: 2, waitingList: 3 });
    seedVolunteer(d1, 'vol-1', 'أ', 'V1');
    seedVolunteer(d1, 'vol-2', 'ب', 'V2');
    seedVolunteer(d1, 'vol-3', 'ج', 'V3');
    seedVolunteer(d1, 'vol-4', 'د', 'V4');
    // CONFIRMED 2/2, one waitlisted, both reg-3 and reg-4 cancelled waitlist-originals
    seedReg(d1, 'reg-1', 'vol-1', 'CONFIRMED', { seat: 1, token: 't1', seq: 1 });
    seedReg(d1, 'reg-2', 'vol-2', 'CONFIRMED', { seat: 2, token: 't2', seq: 2 });
    seedReg(d1, 'reg-3', 'vol-3', 'CANCELLED', { token: 't3', seq: 3 });
    seedReg(d1, 'reg-4', 'vol-4', 'CANCELLED', { token: 't4', seq: 4 });
    d1.prepare(`UPDATE registrations SET original_status='WAITLIST', cancelled_at=datetime('now') WHERE id IN ('reg-3','reg-4')`).run();

    const { app, env } = buildApp(d1);
    // Fire both restores concurrently via Promise.all (both hit the real endpoint)
    const [r3, r4] = await Promise.all([
      httpRestore(app, env, 'reg-3', 't3'),
      httpRestore(app, env, 'reg-4', 't4'),
    ]);

    // Both get 200 (each has gone to WAITLIST at END)
    assertEqual(r3.statusCode, 200, 'reg-3 restore → 200');
    assertEqual(r4.statusCode, 200, 'reg-4 restore → 200');

    const wlRows = await d1.prepare(
      `SELECT id, waitlist_position FROM registrations WHERE status='WAITLIST' ORDER BY waitlist_position ASC`,
    ).all();
    const positions = (wlRows.results as any[]).map((r) => r.waitlist_position as number);
    const unique = new Set(positions);
    assertEqual(positions.length, unique.size, 'all waitlist positions unique (no duplicate position)');
    assertEqual(unique.size, 2, 'exactly 2 waitlist positions (reg-3 and reg-4)');
    assert(positions.includes(1) && positions.includes(2), `positions are 1 and 2 (got: ${positions.join(',')})`);
    // No duplicate confirmed seats
    const confirmedCount = await dbRow(d1, `SELECT COUNT(*) as c FROM registrations WHERE status='CONFIRMED'`);
    assertEqual(confirmedCount.c, 2, 'confirmed unchanged (2) after concurrent restores');
    // No duplicate waitlist count
    const wlCount = await dbRow(d1, `SELECT COUNT(*) as c FROM registrations WHERE status='WAITLIST'`);
    assertEqual(wlCount.c, 2, 'waitlist count = 2 (no overflow)');
  }

  // ═══════ RESULTS ═══════
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`RESULTS: ${passCount}/${testCount} PASS`);
  if (failCount > 0) {
    console.log(`FAILURES: ${failCount}`);
    process.exitCode = 1;
  } else {
    console.log('ALL TESTS PASSED');
  }
})();