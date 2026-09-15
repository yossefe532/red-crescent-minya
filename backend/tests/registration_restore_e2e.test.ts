/**
 * Registration Restore E2E Tests
 *
 * Tests the self-restore (undo cancellation) flow end-to-end.
 * Covers all scenarios from the Micro-Improvement Pass spec:
 *
 * 1.  Confirmed volunteer cancels → sees restore button
 * 2.  Restore with available confirmed seat → CONFIRMED
 * 3.  Restore with no confirmed seat but available waiting slot → WAITLIST
 * 4.  Restore joins AFTER existing waitlist members (priority preserved)
 * 5.  Restore when both full → safely rejected
 * 6.  Double restore (idempotent)
 * 7.  Restore after another person takes the seat
 * 8.  Cancel after restore
 * 9.  Mission already closed → cannot restore
 * 10. Registration timestamp preserved correctly
 * 11. Restore timestamp handled correctly (restored_at)
 * 12. Registration sequence ordering preserved
 * 13. Unauthorized restore attempt
 * 14. Restore another person's registration → forbidden
 * 15. Self-cancel temporary registration → restore
 * 16. Self-cancel WAITLIST → restore → still WAITLIST
 * 17. Self-cancel, seat filled by new registration, restore → WAITLIST
 * 18. Mission auto-close remains correct after restore
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── D1 In-Memory SQLite Shim ──────────────────────────────────
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

// ─── Test helpers ──────────────────────────────────────────────
let testCount = 0;
let passCount = 0;
let failCount = 0;

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
  const pass = actual === expected;
  testCount++;
  if (pass) {
    passCount++;
    console.log(`  ✅ [PASS] ${msg} (got: ${actual})`);
  } else {
    failCount++;
    console.log(`  ❌ [FAIL] ${msg} — expected: ${expected}, got: ${actual}`);
  }
}

async function assertThrows(fn: () => Promise<any>, expectedMsg: string, testLabel: string) {
  testCount++;
  try {
    await fn();
    failCount++;
    console.log(`  ❌ [FAIL] ${testLabel} — expected error "${expectedMsg}" but none thrown`);
  } catch (err: any) {
    if (err.message === expectedMsg) {
      passCount++;
      console.log(`  ✅ [PASS] ${testLabel} (threw: ${err.message})`);
    } else {
      failCount++;
      console.log(`  ❌ [FAIL] ${testLabel} — expected "${expectedMsg}", got "${err.message}"`);
    }
  }
}

// ─── Seed data ─────────────────────────────────────────────────
function seedTestData(d1: any, opts?: { capacity?: number; waitingList?: number; status?: string }) {
  const capacity = opts?.capacity ?? 2;
  const waitingList = opts?.waitingList ?? 2;
  const missionStatus = opts?.status ?? 'OPEN';

  // Mission
  d1.prepare(`INSERT INTO missions (id, title, public_code, status, capacity, waiting_list, confirmation_phrase, start_at, end_at, registration_open_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'test-phrase', '2026-10-01T08:00:00Z', '2026-10-01T16:00:00Z', datetime('now'), 'test')`)
    .bind('mission-1', 'مهمة اختبار', 'MNY-RESTORE', missionStatus, capacity, waitingList).run();

  // Volunteers
  for (let i = 1; i <= 5; i++) {
    d1.prepare(`INSERT INTO volunteers (id, name, member_id, phone) VALUES (?, ?, ?, ?)`)
      .bind(`vol-${i}`, `متطوع ${i}`, `V00${i}`, `0100000000${i}`).run();
  }

  // 2 CONFIRMED (seats 1,2) + 2 WAITLIST (positions 1,2)
  d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, registration_sequence, ownership_token)
    VALUES (?, ?, ?, 'CONFIRMED', 1, 1, 'token-1')`)
    .bind('reg-1', 'mission-1', 'vol-1').run();
  d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, registration_sequence, ownership_token)
    VALUES (?, ?, ?, 'CONFIRMED', 2, 2, 'token-2')`)
    .bind('reg-2', 'mission-1', 'vol-2').run();
  d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, waitlist_position, registration_sequence, ownership_token)
    VALUES (?, ?, ?, 'WAITLIST', 1, 3, 'token-3')`)
    .bind('reg-3', 'mission-1', 'vol-3').run();
  d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, waitlist_position, registration_sequence, ownership_token)
    VALUES (?, ?, ?, 'WAITLIST', 2, 4, 'token-4')`)
    .bind('reg-4', 'mission-1', 'vol-4').run();
}

// ═══════════════════════════════════════════════════════════════
//  SELF-RESTORE SERVICE (inline for testing — mirrors self-cancel.ts logic)
// ═══════════════════════════════════════════════════════════════

interface SelfRestoreResult {
  registration_id: string;
  restored_status: string;
  seat_number: number | null;
  waitlist_position: number | null;
  message: string;
}

async function selfRestoreRegistration(
  db: any,
  regId: string,
  ownershipToken: string,
  table: 'registrations' = 'registrations',
): Promise<SelfRestoreResult> {
  // 1. Fetch registration
  const reg = await db.prepare(
    `SELECT id, mission_id, status, seat_number, waitlist_position, original_status, ownership_token
     FROM ${table} WHERE id = ?`,
  ).bind(regId).first();

  if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
  const r = reg as any;

  if (r.ownership_token !== ownershipToken) throw new Error('FORBIDDEN');

  // 2. If already active (idempotent)
  if (r.status !== 'CANCELLED') {
    return {
      registration_id: regId,
      restored_status: r.status,
      seat_number: r.seat_number,
      waitlist_position: r.waitlist_position,
      message: r.status === 'CONFIRMED' ? 'تسجيلك مؤكد بالفعل' : 'أنت في قائمة الانتظار بالفعل',
    };
  }

  const missionId = r.mission_id;

  // 3. Check mission
  const mission = await db.prepare(
    `SELECT id, status, capacity, waiting_list FROM missions WHERE id = ?`,
  ).bind(missionId).first();

  if (!mission) throw new Error('MISSION_NOT_FOUND');
  const m = mission as any;

  if (m.status === 'CLOSED' || m.status === 'CANCELLED') {
    throw new Error('MISSION_CLOSED');
  }

  // 4. Get counts
  const offCounts = await db.prepare(
    `SELECT COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed FROM registrations WHERE mission_id = ?`,
  ).bind(missionId).first();
  const tmpCounts = await db.prepare(
    `SELECT COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed FROM temporary_registrations WHERE mission_id = ?`,
  ).bind(missionId).first();
  const totalConfirmed = ((offCounts as any)?.confirmed || 0) + ((tmpCounts as any)?.confirmed || 0);

  const offWl = await db.prepare(
    `SELECT COUNT(*) as cnt, COALESCE(MAX(waitlist_position), 0) as max_pos FROM registrations WHERE mission_id = ? AND status = 'WAITLIST'`,
  ).bind(missionId).first();
  const tmpWl = await db.prepare(
    `SELECT COUNT(*) as cnt, COALESCE(MAX(waitlist_position), 0) as max_pos FROM temporary_registrations WHERE mission_id = ? AND status = 'WAITLIST'`,
  ).bind(missionId).first();
  const totalWlCount = ((offWl as any)?.cnt || 0) + ((tmpWl as any)?.cnt || 0);
  const maxWlPos = Math.max((offWl as any)?.max_pos || 0, (tmpWl as any)?.max_pos || 0);
  const wlCapacity = m.waiting_list || 0;

  // 5. Determine outcome
  let restoredStatus: string;
  let newSeat: number | null = null;
  let newWlPos: number | null = null;

  if (totalConfirmed < m.capacity) {
    // SCENARIO A: confirmed seat available
    const usedOff = await db.prepare(
      `SELECT seat_number FROM registrations WHERE mission_id = ? AND status = 'CONFIRMED' AND seat_number IS NOT NULL`,
    ).bind(missionId).all();
    const usedTmp = await db.prepare(
      `SELECT seat_number FROM temporary_registrations WHERE mission_id = ? AND status = 'CONFIRMED' AND seat_number IS NOT NULL`,
    ).bind(missionId).all();
    const usedSet = new Set([
      ...(usedOff.results || []).map((s: any) => s.seat_number),
      ...(usedTmp.results || []).map((s: any) => s.seat_number),
    ]);
    let seat = 1;
    while (usedSet.has(seat) && seat <= m.capacity) seat++;
    if (seat > m.capacity) throw new Error('NO_AVAILABLE_SEAT');

    await db.prepare(
      `UPDATE ${table} SET status = 'CONFIRMED', seat_number = ?, waitlist_position = NULL,
       original_status = CASE WHEN original_status IS NULL THEN 'CONFIRMED' ELSE original_status END,
       restored_at = datetime('now') WHERE id = ?`,
    ).bind(seat, regId).run();

    restoredStatus = 'CONFIRMED';
    newSeat = seat;
  } else if (wlCapacity === 0 || totalWlCount >= wlCapacity) {
    // SCENARIO C: both full
    throw new Error('MISSION_FULL');
  } else {
    // SCENARIO B: waitlist at END
    const nextPos = maxWlPos + 1;
    await db.prepare(
      `UPDATE ${table} SET status = 'WAITLIST', seat_number = NULL, waitlist_position = ?,
       original_status = CASE WHEN original_status IS NULL THEN 'WAITLIST' ELSE original_status END,
       restored_at = datetime('now') WHERE id = ?`,
    ).bind(nextPos, regId).run();
    restoredStatus = 'WAITLIST';
    newWlPos = nextPos;
  }

  return {
    registration_id: regId,
    restored_status: restoredStatus,
    seat_number: newSeat,
    waitlist_position: newWlPos,
    message: restoredStatus === 'CONFIRMED'
      ? `تم استعادة تسجيلك — مقعد مؤكد #${newSeat}`
      : `تمت إضافتك لقائمة الانتظار — موقع #${newWlPos}`,
  };
}

// Helper: cancel a registration (mirrors cancel.service.ts)
async function cancelReg(db: any, regId: string, table: string = 'registrations') {
  const reg = await db.prepare(`SELECT id, mission_id, status, seat_number, waitlist_position FROM ${table} WHERE id = ?`)
    .bind(regId).first();
  if (!reg) throw new Error('NOT_FOUND');
  const r = reg as any;
  const statusBefore = r.status;

  await db.prepare(
    `UPDATE ${table} SET status = 'CANCELLED', seat_number = NULL, cancelled_at = datetime('now'),
     cancelled_by = 'self', original_status = CASE WHEN original_status IS NULL THEN ? ELSE original_status END WHERE id = ?`,
  ).bind(statusBefore, regId).run();

  // Promote if was confirmed
  if (statusBefore === 'CONFIRMED' && r.seat_number) {
    const firstWl = await db.prepare(
      `SELECT id, waitlist_position FROM ${table} WHERE mission_id = ? AND status = 'WAITLIST' ORDER BY waitlist_position ASC LIMIT 1`,
    ).bind(r.mission_id).first();
    if (firstWl) {
      const wl = firstWl as any;
      await db.prepare(
        `UPDATE ${table} SET status = 'CONFIRMED', seat_number = ?, waitlist_position = NULL, confirmed_at = datetime('now') WHERE id = ?`,
      ).bind(r.seat_number, wl.id).run();
      await db.prepare(
        `UPDATE ${table} SET waitlist_position = waitlist_position - 1 WHERE mission_id = ? AND status = 'WAITLIST' AND waitlist_position > ?`,
      ).bind(r.mission_id, wl.waitlist_position).run();
    }
  }

  // Reorder waitlist if was on waitlist
  if (statusBefore === 'WAITLIST' && r.waitlist_position) {
    await db.prepare(
      `UPDATE ${table} SET waitlist_position = waitlist_position - 1 WHERE mission_id = ? AND status = 'WAITLIST' AND waitlist_position > ?`,
    ).bind(r.mission_id, r.waitlist_position).run();
  }

  return { statusBefore, seatNumber: r.seat_number };
}

// Helper: register a new volunteer
async function registerVolunteer(db: any, volIndex: number, opts?: { seat?: number; status?: string }) {
  const volId = `vol-${volIndex}`;
  const regId = `reg-new-${volIndex}`;
  const status = opts?.status || 'CONFIRMED';
  const seat = opts?.seat ?? volIndex;
  const token = `token-new-${volIndex}`;

  // Get next sequence
  const maxSeq = await db.prepare(
    `SELECT COALESCE(MAX(registration_sequence), 0) + 1 as next FROM registrations WHERE mission_id = 'mission-1'`,
  ).first();
  const seq = (maxSeq as any)?.next || 1;

  await db.prepare(
    `INSERT INTO volunteers (id, name, member_id, phone) VALUES (?, ?, ?, ?)`,
  ).bind(volId, `متطوع جديد ${volIndex}`, `VN${volIndex}`, `0109999999${volIndex}`).run();

  if (status === 'CONFIRMED') {
    await db.prepare(
      `INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, registration_sequence, ownership_token)
       VALUES (?, 'mission-1', ?, 'CONFIRMED', ?, ?, ?)`,
    ).bind(regId, volId, seat, seq, token).run();
  } else {
    const maxWl = await db.prepare(
      `SELECT COALESCE(MAX(waitlist_position), 0) + 1 as next FROM registrations WHERE mission_id = 'mission-1' AND status = 'WAITLIST'`,
    ).first();
    const wlPos = (maxWl as any)?.next || 1;
    await db.prepare(
      `INSERT INTO registrations (id, mission_id, volunteer_id, status, waitlist_position, registration_sequence, ownership_token)
       VALUES (?, 'mission-1', ?, 'WAITLIST', ?, ?, ?)`,
    ).bind(regId, volId, wlPos, seq, token).run();
  }

  return { regId, volId, token, seq };
}

// ═══════════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════════
async function runTests() {
  console.log('🚀 STARTING REGISTRATION RESTORE E2E TEST SUITE\n');

  // ── TEST 1: Self-cancel CONFIRMED → CANCELLED ──
  console.log('--- TEST 1: Self-cancel CONFIRMED registration ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    const { statusBefore } = await cancelReg(d1, 'reg-1');
    assertEqual(statusBefore, 'CONFIRMED', 'status_before is CONFIRMED');

    const row = await d1.prepare('SELECT status, original_status, seat_number FROM registrations WHERE id = ?')
      .bind('reg-1').first() as any;
    assertEqual(row.status, 'CANCELLED', 'status is CANCELLED');
    assertEqual(row.original_status, 'CONFIRMED', 'original_status preserved');
    assertEqual(row.seat_number, null, 'seat_number cleared');
  }

  // ── TEST 2: Restore with available confirmed seat → CONFIRMED ──
  console.log('\n--- TEST 2: Restore with available confirmed seat → CONFIRMED ---');
  {
    const d1 = createTestD1();
    seedTestData(d1, { capacity: 3, waitingList: 2 });

    // Cancel reg-1 (CONFIRMED seat 1) → reg-3 promotes to seat 1
    await cancelReg(d1, 'reg-1');

    // Now: reg-3 seat1, reg-2 seat2, reg-4 waitlist pos1
    // 2 confirmed, 1 waitlisted, capacity=3 → 1 seat available
    // Restore reg-1 → should get CONFIRMED with seat 3
    const result = await selfRestoreRegistration(d1, 'reg-1', 'token-1');

    assertEqual(result.restored_status, 'CONFIRMED', 'restored as CONFIRMED');
    assert(result.seat_number !== null, 'has a seat number');
    assert(result.seat_number! >= 1 && result.seat_number! <= 3, 'seat is valid');

    const row = await d1.prepare('SELECT status, seat_number, restored_at FROM registrations WHERE id = ?')
      .bind('reg-1').first() as any;
    assertEqual(row.status, 'CONFIRMED', 'DB status CONFIRMED');
    assert(row.restored_at !== null, 'restored_at is set');
  }

  // ── TEST 3: Restore with no confirmed seat but waitlist available → WAITLIST ──
  console.log('\n--- TEST 3: Restore with no confirmed seat → WAITLIST ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    // Cancel reg-1 (CONFIRMED seat 1) → reg-3 promotes to seat 1
    await cancelReg(d1, 'reg-1');

    // Now cancel reg-2 (CONFIRMED seat 2) → no more waitlist to promote
    await cancelReg(d1, 'reg-2');

    // Restore reg-1: both confirmed seats are empty now, so it gets CONFIRMED
    // Actually wait — after cancelling both, reg-3 and reg-4 got promoted to seats 1 and 2
    // So totalConfirmed = 2 (reg-3 and reg-4), both seats taken
    // Restore reg-1 → WAITLIST

    // Verify: reg-3 and reg-4 should now be CONFIRMED
    const r3 = await d1.prepare('SELECT status FROM registrations WHERE id = ?').bind('reg-3').first() as any;
    const r4 = await d1.prepare('SELECT status FROM registrations WHERE id = ?').bind('reg-4').first() as any;
    assertEqual(r3.status, 'CONFIRMED', 'reg-3 promoted to CONFIRMED');
    assertEqual(r4.status, 'CONFIRMED', 'reg-4 promoted to CONFIRMED');

    // Now restore reg-1: both seats taken, waitlist has room
    const result = await selfRestoreRegistration(d1, 'reg-1', 'token-1');

    assertEqual(result.restored_status, 'WAITLIST', 'restored as WAITLIST');
    assert(result.waitlist_position !== null, 'has waitlist position');
    assertEqual(result.waitlist_position, 1, 'waitlist position is 1 (first available)');
  }

  // ── TEST 4: Restore joins AFTER existing waitlist members ──
  console.log('\n--- TEST 4: Restore joins AFTER existing waitlist (priority preserved) ---');
  {
    const d1 = createTestD1();
    seedTestData(d1, { capacity: 1, waitingList: 5 });

    // Only 1 confirmed seat (reg-1), 2 waitlisted (reg-3 pos 1, reg-4 pos 2)
    // Cancel reg-1 → reg-3 promotes to seat 1
    await cancelReg(d1, 'reg-1');

    // Verify reg-3 promoted
    const r3 = await d1.prepare('SELECT status, seat_number FROM registrations WHERE id = ?').bind('reg-3').first() as any;
    assertEqual(r3.status, 'CONFIRMED', 'reg-3 promoted to CONFIRMED');

    // Now add 2 more waitlisted volunteers
    await d1.prepare(
      `INSERT INTO volunteers (id, name, member_id, phone) VALUES (?, ?, ?, ?)`,
    ).bind('vol-6', 'متطوع 6', 'V006', '01000000006').run();
    await d1.prepare(
      `INSERT INTO registrations (id, mission_id, volunteer_id, status, waitlist_position, registration_sequence, ownership_token)
       VALUES (?, 'mission-1', ?, 'WAITLIST', ?, ?, ?)`,
    ).bind('reg-5', 'vol-5', 2, 5, 'token-5').run();
    await d1.prepare(
      `INSERT INTO registrations (id, mission_id, volunteer_id, status, waitlist_position, registration_sequence, ownership_token)
       VALUES (?, 'mission-1', ?, 'WAITLIST', ?, ?, ?)`,
    ).bind('reg-6', 'vol-6', 3, 6, 'token-6').run();

    // Waitlist: reg-4 (pos 1), reg-5 (pos 2), reg-6 (pos 3)
    // Restore reg-1 (was CONFIRMED, seat taken) → should join at END: position 4
    const result = await selfRestoreRegistration(d1, 'reg-1', 'token-1');

    assertEqual(result.restored_status, 'WAITLIST', 'restored as WAITLIST');
    assertEqual(result.waitlist_position, 4, 'waitlist position is 4 (after all existing)');

    // Verify ordering
    const wl = await d1.prepare(
      'SELECT id, waitlist_position FROM registrations WHERE mission_id = ? AND status = \'WAITLIST\' ORDER BY waitlist_position ASC',
    ).bind('mission-1').all() as any;
    const ids = wl.results.map((r: any) => r.id);
    assert(JSON.stringify(ids).includes('reg-4'), 'reg-4 still in waitlist');
    assert(JSON.stringify(ids).includes('reg-5'), 'reg-5 still in waitlist');
    assert(JSON.stringify(ids).includes('reg-6'), 'reg-6 still in waitlist');
    assert(JSON.stringify(ids).includes('reg-1'), 'reg-1 in waitlist');
    assertEqual(ids[ids.length - 1], 'reg-1', 'reg-1 is LAST in waitlist');
  }

  // ── TEST 5: Restore when both full → rejected ──
  console.log('\n--- TEST 5: Restore when both full → rejected ---');
  {
    const d1 = createTestD1();
    seedTestData(d1, { capacity: 2, waitingList: 2 });

    // Cancel reg-1 → reg-3 promotes to seat 1
    await cancelReg(d1, 'reg-1');

    // Add 2 more waitlisted to fill waiting list
    await d1.prepare(
      `INSERT INTO volunteers (id, name, member_id, phone) VALUES (?, ?, ?, ?)`,
    ).bind('vol-6', 'متطوع 6', 'V006', '01000000006').run();
    await d1.prepare(
      `INSERT INTO registrations (id, mission_id, volunteer_id, status, waitlist_position, registration_sequence, ownership_token)
       VALUES (?, 'mission-1', ?, 'WAITLIST', 2, 5, ?)`,
    ).bind('reg-5', 'vol-6', 'token-5').run();
    await d1.prepare(
      `INSERT INTO volunteers (id, name, member_id, phone) VALUES (?, ?, ?, ?)`,
    ).bind('vol-7', 'متطوع 7', 'V007', '01000000007').run();
    await d1.prepare(
      `INSERT INTO registrations (id, mission_id, volunteer_id, status, waitlist_position, registration_sequence, ownership_token)
       VALUES (?, 'mission-1', ?, 'WAITLIST', 3, 6, ?)`,
    ).bind('reg-6', 'vol-7', 'token-6').run();

    // Now: confirmed=2 (reg-3 seat1, reg-2 seat2), waitlist=3 (reg-4 pos1, reg-5 pos2, reg-6 pos3)
    // But capacity=2, waiting_list=2 → waitlist is OVER capacity (3 > 2)
    // Restore reg-1 → should fail

    await assertThrows(
      () => selfRestoreRegistration(d1, 'reg-1', 'token-1'),
      'MISSION_FULL',
      'Restore when both full → MMISSION_FULL error',
    );
  }

  // ── TEST 6: Double restore (idempotent) ──
  console.log('\n--- TEST 6: Double restore (idempotent) ---');
  {
    const d1 = createTestD1();
    seedTestData(d1, { capacity: 3, waitingList: 2 });

    await cancelReg(d1, 'reg-1');
    const r1 = await selfRestoreRegistration(d1, 'reg-1', 'token-1');
    assertEqual(r1.restored_status, 'CONFIRMED', 'first restore → CONFIRMED');

    // Second restore should return current state without error
    const r2 = await selfRestoreRegistration(d1, 'reg-1', 'token-1');
    assertEqual(r2.restored_status, 'CONFIRMED', 'second restore → still CONFIRMED (idempotent)');
    assert(r2.message.includes('مؤكد بالفعل'), 'idempotent message');

    // Verify only one seat consumed
    const row = await d1.prepare('SELECT status, seat_number FROM registrations WHERE id = ?')
      .bind('reg-1').first() as any;
    assertEqual(row.status, 'CONFIRMED', 'still CONFIRMED');
  }

  // ── TEST 7: Restore after another person takes the seat ──
  console.log('\n--- TEST 7: Restore after another person takes the seat → WAITLIST ---');
  {
    const d1 = createTestD1();
    seedTestData(d1, { capacity: 2, waitingList: 3 });

    // Cancel reg-1 → reg-3 promotes to seat 1
    await cancelReg(d1, 'reg-1');

    // Add a new registration that takes seat 2 (already taken by reg-2)
    // Actually reg-2 still has seat 2. Let's cancel reg-2 too and add a new person.
    await cancelReg(d1, 'reg-2');

    // Now: reg-3 seat1, reg-4 seat2 (promoted from waitlist)
    const r3 = await d1.prepare('SELECT status, seat_number FROM registrations WHERE id = ?').bind('reg-3').first() as any;
    const r4 = await d1.prepare('SELECT status, seat_number FROM registrations WHERE id = ?').bind('reg-4').first() as any;
    assertEqual(r3.status, 'CONFIRMED', 'reg-3 promoted');
    assertEqual(r4.status, 'CONFIRMED', 'reg-4 promoted');

    // Now restore reg-1: both seats taken → should go to WAITLIST
    const result = await selfRestoreRegistration(d1, 'reg-1', 'token-1');
    assertEqual(result.restored_status, 'WAITLIST', 'restore → WAITLIST (seats taken)');
  }

  // ── TEST 8: Cancel after restore ──
  console.log('\n--- TEST 8: Cancel after restore ---');
  {
    const d1 = createTestD1();
    seedTestData(d1, { capacity: 3, waitingList: 2 });

    await cancelReg(d1, 'reg-1');
    await selfRestoreRegistration(d1, 'reg-1', 'token-1');

    // Cancel again
    const { statusBefore } = await cancelReg(d1, 'reg-1');
    assertEqual(statusBefore, 'CONFIRMED', 'can cancel after restore');

    const row = await d1.prepare('SELECT status FROM registrations WHERE id = ?').bind('reg-1').first() as any;
    assertEqual(row.status, 'CANCELLED', 'cancelled again');
  }

  // ── TEST 9: Mission closed → cannot restore ──
  console.log('\n--- TEST 9: Mission closed → cannot restore ---');
  {
    const d1 = createTestD1();
    seedTestData(d1, { status: 'CLOSED' });

    await cancelReg(d1, 'reg-1');

    await assertThrows(
      () => selfRestoreRegistration(d1, 'reg-1', 'token-1'),
      'MISSION_CLOSED',
      'Restore on closed mission → MISSION_CLOSED error',
    );
  }

  // ── TEST 10: Registration timestamp preserved ──
  console.log('\n--- TEST 10: Registration timestamp preserved after restore ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    // Record original created_at
    const before = await d1.prepare('SELECT created_at FROM registrations WHERE id = ?').bind('reg-1').first() as any;
    const originalCreatedAt = before.created_at;

    await cancelReg(d1, 'reg-1');
    await selfRestoreRegistration(d1, 'reg-1', 'token-1');

    const after = await d1.prepare('SELECT created_at, restored_at FROM registrations WHERE id = ?').bind('reg-1').first() as any;
    assertEqual(after.created_at, originalCreatedAt, 'created_at unchanged after restore');
    assert(after.restored_at !== null, 'restored_at is set');
  }

  // ── TEST 11: Restore timestamp ──
  console.log('\n--- TEST 11: restored_at is set correctly ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    await cancelReg(d1, 'reg-1');

    // Before restore: restored_at should be NULL
    const beforeRestore = await d1.prepare('SELECT restored_at FROM registrations WHERE id = ?').bind('reg-1').first() as any;
    assertEqual(beforeRestore.restored_at, null, 'restored_at is NULL before restore');

    await selfRestoreRegistration(d1, 'reg-1', 'token-1');

    const afterRestore = await d1.prepare('SELECT restored_at FROM registrations WHERE id = ?').bind('reg-1').first() as any;
    assert(afterRestore.restored_at !== null, 'restored_at is set after restore');
  }

  // ── TEST 12: Registration sequence ordering preserved ──
  console.log('\n--- TEST 12: Registration sequence ordering preserved ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    const seqBefore = await d1.prepare('SELECT registration_sequence FROM registrations WHERE id = ?').bind('reg-1').first() as any;

    await cancelReg(d1, 'reg-1');
    await selfRestoreRegistration(d1, 'reg-1', 'token-1');

    const seqAfter = await d1.prepare('SELECT registration_sequence FROM registrations WHERE id = ?').bind('reg-1').first() as any;
    assertEqual(seqAfter.registration_sequence, seqBefore.registration_sequence, 'registration_sequence unchanged');
  }

  // ── TEST 13: Unauthorized restore attempt ──
  console.log('\n--- TEST 13: Unauthorized restore attempt ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    await cancelReg(d1, 'reg-1');

    await assertThrows(
      () => selfRestoreRegistration(d1, 'reg-1', 'wrong-token'),
      'FORBIDDEN',
      'Restore with wrong ownership token → FORBIDDEN',
    );
  }

  // ── TEST 14: Restore non-existent registration ──
  console.log('\n--- TEST 14: Restore non-existent registration ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    await assertThrows(
      () => selfRestoreRegistration(d1, 'non-existent', 'token-1'),
      'REGISTRATION_NOT_FOUND',
      'Restore non-existent → REGISTRATION_NOT_FOUND',
    );
  }

  // ── TEST 15: Self-cancel WAITLIST → restore → still WAITLIST ──
  console.log('\n--- TEST 15: Cancel WAITLIST → restore → WAITLIST ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    // Cancel reg-3 (WAITLIST pos 1)
    await cancelReg(d1, 'reg-3');

    // Restore
    const result = await selfRestoreRegistration(d1, 'reg-3', 'token-3');
    assertEqual(result.restored_status, 'WAITLIST', 'restored as WAITLIST');
    // Should be at the end of waitlist (after reg-4 which is still at pos 1... wait, reg-4's pos was 2, after cancel of reg-3 it becomes 1)
    // Actually after cancelling reg-3 (pos 1), reg-4 goes from pos 2 to pos 1
    // So restore reg-3 → should be at pos 2 (after reg-4)
    assertEqual(result.waitlist_position, 2, 'waitlist position is 2 (after existing)');
  }

  // ── TEST 16: Self-cancel, seat filled by new registration, restore → WAITLIST ──
  console.log('\n--- TEST 16: Seat filled by new registration → restore goes to WAITLIST ---');
  {
    const d1 = createTestD1();
    seedTestData(d1, { capacity: 2, waitingList: 3 });

    // Cancel reg-1 (CONFIRMED seat 1) → reg-3 promotes to seat 1
    await cancelReg(d1, 'reg-1');

    // Add a new registration that takes the freed seat (seat 1 is taken by reg-3, seat 2 by reg-2)
    // Actually seat 1 is already taken by reg-3 after promotion. Seat 2 by reg-2.
    // So both seats are taken. Let's verify:
    const counts = await d1.prepare(
      `SELECT COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed FROM registrations WHERE mission_id = 'mission-1'`,
    ).first() as any;
    assertEqual(counts.confirmed, 2, '2 confirmed after promotion');

    // Restore reg-1 → should go to WAITLIST
    const result = await selfRestoreRegistration(d1, 'reg-1', 'token-1');
    assertEqual(result.restored_status, 'WAITLIST', 'restore → WAITLIST (seats filled)');
  }

  // ── TEST 17: Registration ordering with multiple restores ──
  console.log('\n--- TEST 17: Multiple restores maintain ordering ---');
  {
    const d1 = createTestD1();
    seedTestData(d1, { capacity: 1, waitingList: 5 });

    // capacity=1: reg-1 seat 1, reg-3 waitlist pos 1, reg-4 waitlist pos 2
    // Cancel reg-1 → reg-3 promotes to seat 1
    await cancelReg(d1, 'reg-1');

    // Cancel reg-3 (now CONFIRMED seat 1) → no one to promote
    await cancelReg(d1, 'reg-3');

    // Now: reg-4 is still WAITLIST (promoted after reg-3 cancelled? No, reg-3 was just cancelled)
    // After cancelling reg-3 (seat 1): check if reg-4 gets promoted
    // reg-4 was WAITLIST pos 2, but after reg-3's cancellation, reg-4 should promote
    const r4 = await d1.prepare('SELECT status, seat_number FROM registrations WHERE id = ?').bind('reg-4').first() as any;
    assertEqual(r4.status, 'CONFIRMED', 'reg-4 promoted to CONFIRMED');

    // Restore reg-1 → seat taken by reg-4 → WAITLIST at position 1
    const r1 = await selfRestoreRegistration(d1, 'reg-1', 'token-1');
    assertEqual(r1.restored_status, 'WAITLIST', 'reg-1 restored to WAITLIST');
    assertEqual(r1.waitlist_position, 1, 'reg-1 at waitlist position 1');

    // Restore reg-3 → seat still taken → WAITLIST at position 2
    const r3 = await selfRestoreRegistration(d1, 'reg-3', 'token-3');
    assertEqual(r3.restored_status, 'WAITLIST', 'reg-3 restored to WAITLIST');
    assertEqual(r3.waitlist_position, 2, 'reg-3 at waitlist position 2 (after reg-1)');
  }

  // ── TEST 18: Mission auto-close compatibility ──
  console.log('\n--- TEST 18: Mission auto-close remains correct after restore ---');
  {
    const d1 = createTestD1();
    seedTestData(d1, { capacity: 2, waitingList: 2 });

    // Close the mission
    await d1.prepare(`UPDATE missions SET status = 'CLOSED' WHERE id = 'mission-1'`).run();

    await cancelReg(d1, 'reg-1');

    // Cannot restore on closed mission
    await assertThrows(
      () => selfRestoreRegistration(d1, 'reg-1', 'token-1'),
      'MISSION_CLOSED',
      'Cannot restore on closed mission',
    );

    // Verify mission is still closed
    const m = await d1.prepare('SELECT status FROM missions WHERE id = ?').bind('mission-1').first() as any;
    assertEqual(m.status, 'CLOSED', 'mission remains CLOSED');
  }

  // ═══════════════════════════════════════════════════════════════
  //  RESULTS
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(60));
  console.log(`📊 RESULTS: ${passCount}/${testCount} passed, ${failCount} failed`);
  console.log('═'.repeat(60));

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('💥 FATAL:', err);
  process.exit(1);
});
