/**
 * Phase 6 Tests — Live Mission, Realtime & Live Roster
 *
 * Tests the version-based change detection and live endpoint logic.
 * The actual HTTP endpoint is tested via the live polling mechanism.
 * These tests verify the underlying database operations.
 *
 * Scenarios:
 *   1. Version column exists and defaults to 0
 *   2. Version increments on registration
 *   3. Version increments on cancellation
 *   4. Roster query excludes cancelled registrations
 *   5. Mission data includes all required fields
 *  12. Available seats calculation is correct
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Services under test
import { cancelRegistration } from '../src/services/cancel.service';
import { restoreRegistration } from '../src/services/restore.service';
import { incrementMissionVersion } from '../src/utils/version';

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

// ─── Seed data ─────────────────────────────────────────────────
function seedTestData(d1: any) {
  // Mission with capacity=2, waiting_list=2, version=0
  d1.prepare(`INSERT INTO missions (id, title, public_code, status, capacity, waiting_list, confirmation_phrase, start_at, end_at, registration_open_at, created_by, version)
    VALUES (?, ?, ?, 'OPEN', 2, 2, 'test-phrase', '2026-10-01T08:00:00Z', '2026-10-01T16:00:00Z', datetime('now'), 'test', 0)`)
    .bind('mission-1', 'مهمة اختبار Phase6', 'MNY-P6').run();

  // Volunteers
  d1.prepare(`INSERT INTO volunteers (id, name, member_id, phone) VALUES (?, ?, ?, ?)`)
    .bind('vol-1', 'أحمد الأولى', 'V001', '01000000001').run();
  d1.prepare(`INSERT INTO volunteers (id, name, member_id, phone) VALUES (?, ?, ?, ?)`)
    .bind('vol-2', 'محمد الثاني', 'V002', '01000000002').run();
  d1.prepare(`INSERT INTO volunteers (id, name, member_id, phone) VALUES (?, ?, ?, ?)`)
    .bind('vol-3', 'علي الثالث', 'V003', '01000000003').run();
  d1.prepare(`INSERT INTO volunteers (id, name, member_id, phone) VALUES (?, ?, ?, ?)`)
    .bind('vol-4', 'خالد الرابع', 'V004', '01000000004').run();

  // 2 CONFIRMED (seats 1,2) + 2 WAITLIST (positions 1,2)
  d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, registration_sequence, ownership_token, original_status)
    VALUES (?, ?, ?, 'CONFIRMED', 1, 1, 'token-owner-1', NULL)`)
    .bind('reg-1', 'mission-1', 'vol-1').run();
  d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, registration_sequence, ownership_token, original_status)
    VALUES (?, ?, ?, 'CONFIRMED', 2, 2, 'token-owner-2', NULL)`)
    .bind('reg-2', 'mission-1', 'vol-2').run();
  d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, waitlist_position, registration_sequence, ownership_token, original_status)
    VALUES (?, ?, ?, 'WAITLIST', 1, 3, 'token-owner-3', NULL)`)
    .bind('reg-3', 'mission-1', 'vol-3').run();
  d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, waitlist_position, registration_sequence, ownership_token, original_status)
    VALUES (?, ?, ?, 'WAITLIST', 2, 4, 'token-owner-4', NULL)`)
    .bind('reg-4', 'mission-1', 'vol-4').run();
}

// ─── Test Suite Runner ─────────────────────────────────────────
async function runTests() {
  console.log('🚀 STARTING PHASE 6 LIVE REALTIME TEST SUITE\n');

  // ── TEST 1: Version column exists and defaults to 0 ──
  console.log('--- TEST 1: Version Column Exists ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    const mission = await d1.prepare('SELECT version FROM missions WHERE id = ?')
      .bind('mission-1').first() as any;
    assert(mission !== null, 'Mission has version column');
    assertEqual(mission.version, 0, 'Version defaults to 0');
  }

  // ── TEST 2: incrementMissionVersion works ──
  console.log('\n--- TEST 2: incrementMissionVersion ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    await incrementMissionVersion(d1, 'mission-1');
    let m = await d1.prepare('SELECT version FROM missions WHERE id = ?')
      .bind('mission-1').first() as any;
    assertEqual(m.version, 1, 'Version increments to 1');

    await incrementMissionVersion(d1, 'mission-1');
    m = await d1.prepare('SELECT version FROM missions WHERE id = ?')
      .bind('mission-1').first() as any;
    assertEqual(m.version, 2, 'Version increments to 2');

    await incrementMissionVersion(d1, 'mission-1');
    m = await d1.prepare('SELECT version FROM missions WHERE id = ?')
      .bind('mission-1').first() as any;
    assertEqual(m.version, 3, 'Version increments to 3');
  }

  // ── TEST 3: cancelRegistration increments version ──
  console.log('\n--- TEST 3: cancelRegistration Increments Version ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    const before = await d1.prepare('SELECT version FROM missions WHERE id = ?')
      .bind('mission-1').first() as any;
    assertEqual(before.version, 0, 'Version starts at 0');

    await cancelRegistration(d1, 'reg-1', 'admin');

    const after = await d1.prepare('SELECT version FROM missions WHERE id = ?')
      .bind('mission-1').first() as any;
    assertEqual(after.version, 1, 'Version incremented to 1 after cancel');
  }

  // ── TEST 4: restoreRegistration increments version ──
  console.log('\n--- TEST 4: restoreRegistration Increments Version ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    // Cancel first
    await cancelRegistration(d1, 'reg-1', 'admin');
    const afterCancel = await d1.prepare('SELECT version FROM missions WHERE id = ?')
      .bind('mission-1').first() as any;
    assertEqual(afterCancel.version, 1, 'Version = 1 after cancel');

    // Restore
    await restoreRegistration(d1, 'reg-1', 'admin');
    const afterRestore = await d1.prepare('SELECT version FROM missions WHERE id = ?')
      .bind('mission-1').first() as any;
    assertEqual(afterRestore.version, 2, 'Version = 2 after restore');
  }

  // ── TEST 5: Roster query excludes cancelled registrations ──
  console.log('\n--- TEST 5: Roster Excludes Cancelled ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    // Cancel one registration
    await cancelRegistration(d1, 'reg-1', 'admin');

    // Query roster (same SQL as live endpoint)
    const roster = await d1.prepare(`
      SELECT r.id, v.name, v.member_id, r.status, r.seat_number, r.waitlist_position, r.created_at
      FROM registrations r
      JOIN volunteers v ON r.volunteer_id = v.id
      WHERE r.mission_id = ?
        AND r.status != 'CANCELLED'
      ORDER BY r.seat_number ASC NULLS LAST, r.waitlist_position ASC NULLS LAST
    `).bind('mission-1').all() as any;

    assertEqual(roster.results.length, 3, 'Roster has 3 entries (1 cancelled excluded)');
    const cancelledInRoster = roster.results.filter((r: any) => r.status === 'CANCELLED');
    assertEqual(cancelledInRoster.length, 0, 'No CANCELLED in roster');
  }

  // ── TEST 6: Available seats calculation ──
  console.log('\n--- TEST 6: Available Seats Calculation ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    const mission = await d1.prepare('SELECT capacity FROM missions WHERE id = ?')
      .bind('mission-1').first() as any;
    const counts = await d1.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed
      FROM registrations WHERE mission_id = ?
    `).bind('mission-1').first() as any;

    const available = Math.max(0, mission.capacity - counts.confirmed);
    assertEqual(available, 0, 'Available = 0 when all seats taken');
  }

  // ── TEST 7: Available seats after cancellation with promotion ──
  console.log('\n--- TEST 7: Available Seats After Cancel (With Promotion) ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    // Cancel one confirmed — waitlist promotion fills the seat
    await cancelRegistration(d1, 'reg-1', 'admin');

    const mission = await d1.prepare('SELECT capacity FROM missions WHERE id = ?')
      .bind('mission-1').first() as any;
    const counts = await d1.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed
      FROM registrations WHERE mission_id = ?
    `).bind('mission-1').first() as any;

    // After cancel + promotion: 1 original confirmed + 1 promoted = 2 confirmed
    // Available should still be 0 (seat was filled by promotion)
    assertEqual(counts.confirmed, 2, 'Confirmed still 2 after promotion fills seat');
    const available = Math.max(0, mission.capacity - counts.confirmed);
    assertEqual(available, 0, 'Available = 0 after promotion fills freed seat');

    // But total waitlist decreased
    const waitlist = await d1.prepare(`
      SELECT COUNT(*) as count FROM registrations WHERE mission_id = ? AND status = 'WAITLIST'
    `).bind('mission-1').first() as any;
    assertEqual(waitlist.count, 1, 'Waitlist decreased to 1 after promotion');
  }

  // ── TEST 8: Roster includes waitlisted registrations ──
  console.log('\n--- TEST 8: Roster Includes Waitlisted ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    const roster = await d1.prepare(`
      SELECT r.id, r.status
      FROM registrations r
      WHERE r.mission_id = ? AND r.status != 'CANCELLED'
      ORDER BY r.seat_number ASC NULLS LAST, r.waitlist_position ASC NULLS LAST
    `).bind('mission-1').all() as any;

    const confirmed = roster.results.filter((r: any) => r.status === 'CONFIRMED');
    const waitlisted = roster.results.filter((r: any) => r.status === 'WAITLIST');
    assertEqual(confirmed.length, 2, 'Roster has 2 CONFIRMED');
    assertEqual(waitlisted.length, 2, 'Roster has 2 WAITLIST');
  }

  // ── TEST 9: Version comparison logic (changed vs unchanged) ──
  console.log('\n--- TEST 9: Version Comparison Logic ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    // Get current version
    const m1 = await d1.prepare('SELECT version FROM missions WHERE id = ?')
      .bind('mission-1').first() as any;
    const currentVersion = m1.version;

    // Simulate: client sends since_version = currentVersion → changed = false
    const m2 = await d1.prepare('SELECT version FROM missions WHERE id = ?')
      .bind('mission-1').first() as any;
    const changed = m2.version !== currentVersion;
    assertEqual(changed, false, 'No change when version matches');

    // Now increment
    await incrementMissionVersion(d1, 'mission-1');

    // Simulate: client sends since_version = old version → changed = true
    const m3 = await d1.prepare('SELECT version FROM missions WHERE id = ?')
      .bind('mission-1').first() as any;
    const changed2 = m3.version !== currentVersion;
    assertEqual(changed2, true, 'Change detected when version differs');
  }

  // ── TEST 10: Registration with ownership token ──
  console.log('\n--- TEST 10: Ownership Token in Roster ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    // Query my_registrations (same SQL as live endpoint)
    const myRegs = await d1.prepare(`
      SELECT r.id, r.status, r.seat_number, r.waitlist_position, r.ownership_token
      FROM registrations r
      WHERE r.mission_id = ? AND r.ownership_token = ? AND r.status != 'CANCELLED'
    `).bind('mission-1', 'token-owner-1').all() as any;

    assertEqual(myRegs.results.length, 1, 'Found 1 registration for token-owner-1');
    assertEqual(myRegs.results[0].status, 'CONFIRMED', 'Registration is CONFIRMED');
  }

  // ── TEST 11: My registrations empty without token ──
  console.log('\n--- TEST 11: My Registrations Without Token ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    const myRegs = await d1.prepare(`
      SELECT r.id, r.status
      FROM registrations r
      WHERE r.mission_id = ? AND r.ownership_token = ? AND r.status != 'CANCELLED'
    `).bind('mission-1', '').all() as any;

    assertEqual(myRegs.results.length, 0, 'No registrations for empty token');
  }

  // ── TEST 12: Full mission roster still visible ──
  console.log('\n--- TEST 12: Full Mission Roster Visibility ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    // Mission is full (capacity=2, confirmed=2)
    const mission = await d1.prepare('SELECT capacity FROM missions WHERE id = ?')
      .bind('mission-1').first() as any;
    const counts = await d1.prepare(`
      SELECT COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed,
             COUNT(CASE WHEN status = 'WAITLIST' THEN 1 END) as waitlist
      FROM registrations WHERE mission_id = ?
    `).bind('mission-1').first() as any;

    const isFull = counts.confirmed >= mission.capacity;
    assertEqual(isFull, true, 'Mission is full');

    // But roster is still accessible
    const roster = await d1.prepare(`
      SELECT r.id, r.status
      FROM registrations r
      WHERE r.mission_id = ? AND r.status != 'CANCELLED'
    `).bind('mission-1').all() as any;

    assertEqual(roster.results.length, 4, 'Full mission roster still shows all 4 registrations');
  }

  // ── Summary ──
  console.log('\n=============================================');
  console.log(`🎯 PHASE 6 RESULTS: ${passCount} passed, ${failCount} failed, ${testCount} total`);
  console.log('=============================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('❌ FATAL:', err);
  process.exit(1);
});
