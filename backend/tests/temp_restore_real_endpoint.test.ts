/**
 * TEMPORARY REGISTRATION SELF-RESTORE — REAL HTTP ENDPOINT INTEGRATION TEST
 *
 * Tests the ACTUAL Hono route (self-cancel.ts → POST /temporary-registrations/:regId/self-restore) via app.request(),
 * with real bindings (DB), NOT an inline copy of the logic.
 *
 * Covers the security/ownership/state/capacity audit requirements for the TEMP endpoint:
 *   A. confirmed seat available → restore as CONFIRMED
 *   B. confirmed full + waiting space → restore at END of waiting list
 *   C. waiting full → reject
 *   D. double restore → one logical restore
 *   E. concurrent restores → unique seats / waitlist positions
 *   F. unauthorized restore → DENIED
 *   G. closed mission → DENIED/REJECTED
 */
import { Hono } from 'hono';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { selfCancelRoutes } from '../src/routes/self-cancel';
import { Env } from '../src/env';

// ─── D1 In-Memory SQLite Shim ───────────────────────────────────
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
    .bind('mission-1', 'مهمة اختبار', 'MNY-TEMP', status, capacity, waitingList).run();
}

// Seed a volunteer (needed for official registrations FK)
function seedVolunteer(d1: any, id: string, name: string, memberId: string) {
  d1.prepare(`INSERT INTO volunteers (id, name, member_id, phone) VALUES (?, ?, ?, ?)`)
    .bind(id, name, memberId, `0100000000${memberId.slice(-1)}`).run();
}

// Seed an official registration (for cross-table max-seat/count queries)
function seedOfficialReg(d1: any, id: string, volId: string, status: string, opts?: { seat?: number | null; wl?: number | null; seq?: number }) {
  seedVolunteer(d1, volId, `${volId}-name`, volId.toUpperCase());
  const seat = opts?.seat ?? null;
  const wl = opts?.wl ?? null;
  const seq = opts?.seq ?? 0;
  if (seat !== null) {
    d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, waitlist_position, registration_sequence, ownership_token)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`).bind(id, 'mission-1', volId, status, seat, seq, `tok-${volId}`).run();
  } else if (wl !== null) {
    d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, waitlist_position, registration_sequence, ownership_token)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`).bind(id, 'mission-1', volId, status, wl, seq, `tok-${volId}`).run();
  } else {
    d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, waitlist_position, registration_sequence, ownership_token)
      VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`).bind(id, 'mission-1', volId, status, seq, `tok-${volId}`).run();
  }
}

// Seed a temporary registration
function seedTempReg(d1: any, id: string, opts: { name?: string; status?: string; seat?: number | null; wl?: number | null; token?: string; seq?: number; originalStatus?: string; phone?: string }) {
  const name = opts.name ?? `temp-${id}`;
  const status = opts.status ?? 'CANCELLED';
  const seat = opts.seat ?? null;
  const wl = opts.wl ?? null;
  const token = opts.token ?? `temptok-${id}`;
  const seq = opts.seq ?? 0;
  const orig = opts.originalStatus ?? 'CONFIRMED';
  const phone = opts.phone ?? `011${String(Math.abs(hash(id)) % 100000000).padStart(8, '0')}`;
  if (seat !== null) {
    d1.prepare(`INSERT INTO temporary_registrations (id, mission_id, name, phone, status, seat_number, waitlist_position, registration_sequence, ownership_token, original_status, created_at, confirmed_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, datetime('now'), datetime('now'))`).bind(id, 'mission-1', name, phone, status, seat, seq, token, orig).run();
  } else if (wl !== null) {
    d1.prepare(`INSERT INTO temporary_registrations (id, mission_id, name, phone, status, seat_number, waitlist_position, registration_sequence, ownership_token, original_status, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, datetime('now'))`).bind(id, 'mission-1', name, phone, status, wl, seq, token, orig).run();
  } else {
    d1.prepare(`INSERT INTO temporary_registrations (id, mission_id, name, phone, status, seat_number, waitlist_position, registration_sequence, ownership_token, original_status, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, datetime('now'))`).bind(id, 'mission-1', name, phone, status, seq, token, orig).run();
  }
}
function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
  return h;
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

// Helper: restore temp regId via real HTTP
async function httpTempRestore(app: any, env: any, regId: string, token?: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers['Cookie'] = `ownership_token=${token}`;
  const res = await app.request(`/api/temporary-registrations/${regId}/self-restore`, { method: 'POST', headers }, env);
  const body = await res.json();
  return { statusCode: res.status, body };
}

// Helper: direct DB row read
async function dbRow(d1: any, sql: string, ...params: any[]) {
  return d1.prepare(sql).bind(...params).first();
}

(async () => {
  // ═══════ TEST A: confirmed seat available → CONFIRMED ═══════
  console.log('\n=== TEST A (temp): Confirmed seat available → CONFIRMED ===');
  {
    const d1 = createTestD1();
    seedMission(d1, { capacity: 3, waitingList: 2 });
    // 1 confirmed (seat 1) in OFFICIAL → temp gets seat 2
    seedOfficialReg(d1, 'off-1', 'vol-off1', 'CONFIRMED', { seat: 1, seq: 1 });
    seedTempReg(d1, 'temp-1', { name: 'أحمد', status: 'CANCELLED', originalStatus: 'CONFIRMED', token: 'temptok-1', seq: 1 });

    const { app, env } = buildApp(d1);
    const res = await httpTempRestore(app, env, 'temp-1', 'temptok-1');

    assertEqual(res.statusCode, 200, 'A: returns 200 OK');
    assertEqual(res.body.data?.restored_status, 'CONFIRMED', 'A: restored to CONFIRMED');
    const row = await dbRow(d1, `SELECT status, seat_number, waitlist_position FROM temporary_registrations WHERE id='temp-1'`);
    assertEqual(row.status, 'CONFIRMED', 'A: DB status = CONFIRMED');
    assert(row.seat_number >= 1 && row.seat_number <= 3, `A: valid seat assigned (#${row.seat_number})`);
    assert(row.waitlist_position === null, 'A: waitlist_position is NULL');
  }

  // ═══════ TEST B: confirmed full + waiting space → WAITLIST at END ═══════
  console.log('\n=== TEST B (temp): Full confirmed + waitlist room → WAITLIST at END ===');
  {
    const d1 = createTestD1();
    seedMission(d1, { capacity: 2, waitingList: 3 });
    // CONFIRMED 2/2 official seats, WAITLIST 1/3
    seedOfficialReg(d1, 'off-1', 'vol-off1', 'CONFIRMED', { seat: 1, seq: 1 });
    seedOfficialReg(d1, 'off-2', 'vol-off2', 'CONFIRMED', { seat: 2, seq: 2 });
    seedOfficialReg(d1, 'off-3', 'vol-off3', 'WAITLIST', { wl: 1, seq: 3 });
    // temp was CONFIRMED, cancelled, now restore → no seat → WAITLIST position 2
    seedTempReg(d1, 'temp-1', { name: 'محمد', status: 'CANCELLED', originalStatus: 'CONFIRMED', token: 'temptok-1', seq: 4 });

    const { app, env } = buildApp(d1);
    const res = await httpTempRestore(app, env, 'temp-1', 'temptok-1');

    assertEqual(res.statusCode, 200, 'B: returns 200 OK');
    assertEqual(res.body.data?.restored_status, 'WAITLIST', 'B: restored to WAITLIST');
    const row = await dbRow(d1, `SELECT status, waitlist_position, seat_number FROM temporary_registrations WHERE id='temp-1'`);
    assertEqual(row.status, 'WAITLIST', 'B: DB status = WAITLIST');
    assertEqual(row.waitlist_position, 2, 'B: joins at END, position 2');
    assert(row.seat_number === null, 'B: seat_number is NULL');
    // Verify off-3 still at position 1
    const off3 = await dbRow(d1, `SELECT waitlist_position FROM registrations WHERE id='off-3'`);
    assertEqual(off3.waitlist_position, 1, 'B: existing waitlist user stays at position 1');
  }

  // ═══════ TEST C: waiting full → reject ═══════
  console.log('\n=== TEST C (temp): Waitlist FULL → rejected ===');
  {
    const d1 = createTestD1();
    seedMission(d1, { capacity: 2, waitingList: 2 });
    seedOfficialReg(d1, 'off-1', 'vol-off1', 'CONFIRMED', { seat: 1, seq: 1 });
    seedOfficialReg(d1, 'off-2', 'vol-off2', 'CONFIRMED', { seat: 2, seq: 2 });
    seedOfficialReg(d1, 'off-3', 'vol-off3', 'WAITLIST', { wl: 1, seq: 3 });
    seedOfficialReg(d1, 'off-4', 'vol-off4', 'WAITLIST', { wl: 2, seq: 4 });
    // temp cancelled, restore → both full
    seedTempReg(d1, 'temp-1', { name: 'خالد', status: 'CANCELLED', originalStatus: 'CONFIRMED', token: 'temptok-1', seq: 5 });

    const { app, env } = buildApp(d1);
    const res = await httpTempRestore(app, env, 'temp-1', 'temptok-1');

    assertEqual(res.statusCode, 409, 'C: returns 409 CONFLICT');
    assert(res.body.error?.message?.includes('ممتلئ'), `C: error mentions full: "${res.body.error?.message}"`);
    const row = await dbRow(d1, `SELECT status FROM temporary_registrations WHERE id='temp-1'`);
    assertEqual(row.status, 'CANCELLED', 'C: remains CANCELLED');
  }

  // ═══════ TEST D: double restore → one logical restore ═══════
  console.log('\n=== TEST D (temp): Double restore → idempotent ===');
  {
    const d1 = createTestD1();
    seedMission(d1, { capacity: 2, waitingList: 2 });
    seedTempReg(d1, 'temp-1', { name: 'عادل', status: 'CANCELLED', originalStatus: 'CONFIRMED', token: 'temptok-1', seq: 1 });

    const { app, env } = buildApp(d1);
    const res1 = await httpTempRestore(app, env, 'temp-1', 'temptok-1');
    assertEqual(res1.statusCode, 200, 'D: first restore 200');
    assertEqual(res1.body?.data?.restored_status, 'CONFIRMED', 'D: first restore → CONFIRMED (seat available)');
    const res2 = await httpTempRestore(app, env, 'temp-1', 'temptok-1');
    // Second restore: status is no longer CANCELLED → idempotent no-op, returns current state
    assert([200, 400, 409].includes(res2.statusCode), `D: second restore returns ${res2.statusCode} (not crash)`);
    // One logical restore: still CONFIRMED, exactly ONE seat alloc
    const row = await dbRow(d1, `SELECT status, seat_number FROM temporary_registrations WHERE id='temp-1'`);
    assertEqual(row.status, 'CONFIRMED', 'D: status = CONFIRMED after double restore');
    // No duplicate seat / no spurious waitlist entry
    const seatCount = await dbRow(d1, `SELECT COUNT(*) as c FROM temporary_registrations WHERE status='CONFIRMED' AND mission_id='mission-1' AND seat_number IS NOT NULL`);
    assertEqual(seatCount.c, 1, 'D: exactly 1 seat allocated (no duplicate seat)');
    const wlCount = await dbRow(d1, `SELECT COUNT(*) as c FROM temporary_registrations WHERE status='WAITLIST' AND mission_id='mission-1'`);
    assertEqual(wlCount.c, 0, 'D: no spurious waitlist entry');
  }

  // ═══════ TEST E: concurrent restores → unique seats/positions ═══════
  console.log('\n=== TEST E (temp): Concurrent restores → unique seats/positions ===');
  {
    const d1 = createTestD1();
    seedMission(d1, { capacity: 2, waitingList: 3 });
    // 2 official confirmed → seats full, waitlist empty
    seedOfficialReg(d1, 'off-1', 'vol-off1', 'CONFIRMED', { seat: 1, seq: 1 });
    seedOfficialReg(d1, 'off-2', 'vol-off2', 'CONFIRMED', { seat: 2, seq: 2 });
    // 3 temp CANCELLED → all restore to WAITLIST (positions 1, 2, 3)
    seedTempReg(d1, 'temp-1', { name: 'أحمد', status: 'CANCELLED', originalStatus: 'CONFIRMED', token: 'temptok-1', seq: 3 });
    seedTempReg(d1, 'temp-2', { name: 'محمد', status: 'CANCELLED', originalStatus: 'CONFIRMED', token: 'temptok-2', seq: 4 });
    seedTempReg(d1, 'temp-3', { name: 'خالد', status: 'CANCELLED', originalStatus: 'CONFIRMED', token: 'temptok-3', seq: 5 });

    const { app, env } = buildApp(d1);
    // Fire 3 concurrent restores
    const [r1, r2, r3] = await Promise.all([
      httpTempRestore(app, env, 'temp-1', 'temptok-1'),
      httpTempRestore(app, env, 'temp-2', 'temptok-2'),
      httpTempRestore(app, env, 'temp-3', 'temptok-3'),
    ]);

    // All should succeed
    assertEqual(r1.statusCode, 200, 'E: temp-1 restore 200');
    assertEqual(r2.statusCode, 200, 'E: temp-2 restore 200');
    assertEqual(r3.statusCode, 200, 'E: temp-3 restore 200');

    // All restored to WAITLIST
    for (const id of ['temp-1', 'temp-2', 'temp-3']) {
      const row = await dbRow(d1, `SELECT status, seat_number FROM temporary_registrations WHERE id=?`, id);
      assertEqual(row.status, 'WAITLIST', `E: ${id} is WAITLIST`);
      assert(row.seat_number === null, `E: ${id} seat_number is NULL`);
    }

    // CRITICAL: check for duplicate waitlist positions
    const positionsResult = await d1.prepare(
      `SELECT waitlist_position FROM temporary_registrations WHERE mission_id='mission-1' AND status='WAITLIST'`
    ).all() as any;
    const posValues = (positionsResult.results as any[]).map((p: any) => p.waitlist_position).sort((a: number, b: number) => a - b);
    console.log(`    positions: [${posValues.join(', ')}]`);
    assert(posValues.includes(1) && posValues.includes(2) && posValues.includes(3),
      `E: positions include 1, 2, 3 (no duplicates)`);
    assertEqual(posValues.length, 3, 'E: exactly 3 waitlist positions');

    // No duplicate seats
    const seatCount = await dbRow(d1, `SELECT COUNT(*) as c FROM temporary_registrations WHERE seat_number IS NOT NULL AND mission_id='mission-1'`);
    assertEqual(seatCount.c, 0, 'E: no temp confirmed seats (all waitlist)');
  }

  // ═══════ TEST F: unauthorized restore → DENIED ═══════
  console.log('\n=== TEST F (temp): Unauthorized restore DENIED ===');
  {
    const d1 = createTestD1();
    seedMission(d1, { capacity: 2, waitingList: 2 });
    seedTempReg(d1, 'temp-1', { name: 'أحمد', status: 'CANCELLED', originalStatus: 'CONFIRMED', token: 'temptok-1', seq: 1 });
    seedTempReg(d1, 'temp-2', { name: 'محمد', status: 'CANCELLED', originalStatus: 'CONFIRMED', token: 'temptok-2', seq: 2 });

    const { app, env } = buildApp(d1);

    // (a) wrong token
    const ra = await httpTempRestore(app, env, 'temp-1', 'temptok-WRONG');
    assertEqual(ra.statusCode, 403, 'F(a): wrong token → 403');

    // (b) no token
    const rb = await httpTempRestore(app, env, 'temp-1');
    assert(rb.statusCode === 401 || rb.statusCode === 403, `F(b): no token → ${rb.statusCode}`);

    // (c) restore by another user's token (cross-user)
    const rc = await httpTempRestore(app, env, 'temp-1', 'temptok-2');
    assertEqual(rc.statusCode, 403, 'F(c): cross-user token → 403');

    // (d) no cookie header at all
    const rd = await httpTempRestore(app, env, 'temp-1', undefined);
    assert(rd.statusCode === 401 || rd.statusCode === 403, `F(d): no cookie → ${rd.statusCode}`);
  }

  // ═══════ TEST G: closed mission → REJECT ═══════
  console.log('\n=== TEST G (temp): Closed mission → REJECTED ===');
  {
    const d1 = createTestD1();
    seedMission(d1, { capacity: 2, waitingList: 2, status: 'CLOSED' });
    seedTempReg(d1, 'temp-1', { name: 'أحمد', status: 'CANCELLED', originalStatus: 'CONFIRMED', token: 'temptok-1', seq: 1 });

    const { app, env } = buildApp(d1);
    const res = await httpTempRestore(app, env, 'temp-1', 'temptok-1');

    assertEqual(res.statusCode, 409, 'G: CLOSED mission → 409');
    assert(res.body.error?.message?.includes('مغلقة'), `G: error mentions closed: "${res.body.error?.message}"`);
  }

  // ═══════ SUMMARY ═══════
  console.log('\n' + '='.repeat(60));
  console.log(`TEMP ENDPOINT REAL HTTP TEST — ${testCount} tests: ${passCount} PASS, ${failCount} FAIL`);
  console.log('='.repeat(60));
  if (failCount > 0) {
    process.exit(1);
  }
})();
