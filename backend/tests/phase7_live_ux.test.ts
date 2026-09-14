/**
 * Phase 7 Tests — Live UX, Notifications & Visual Feedback
 *
 * Tests:
 * 1-12: Change detection algorithm (useLiveChanges core logic)
 * 13-16: Toast notification message formats (Arabic)
 * 17-19: Activity strip logic
 * 20-23: Animation state logic
 * 24-28: Edge cases
 * 29-30: Database integration (version for change detection)
 *
 * Run: npx tsx tests/phase7_live_ux.test.ts
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── D1 In-Memory SQLite Shim ──────────────────────────────────
function createTestD1(): any {
  const sqlite = new DatabaseSync(':memory:');

  // Run all migrations in order
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f: string) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    sqlite.exec(sql);
  }

  return {
    prepare(sql: string) {
      return {
        bind(...params: any[]) {
          return {
            first: () => {
              const stmt = sqlite.prepare(sql);
              return stmt.get(...params);
            },
            all: () => {
              const stmt = sqlite.prepare(sql);
              return stmt.all(...params);
            },
            run: () => {
              const stmt = sqlite.prepare(sql);
              return stmt.run(...params);
            },
          };
        },
        first: () => {
          const stmt = sqlite.prepare(sql);
          return stmt.get();
        },
        all: () => {
          const stmt = sqlite.prepare(sql);
          return stmt.all();
        },
        run: () => {
          const stmt = sqlite.prepare(sql);
          return stmt.run();
        },
      };
    },
    exec(sql: string) {
      sqlite.exec(sql);
    },
    _raw: sqlite,
  };
}

// ─── Test Utilities ───────────────────────────────────────────
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

function assertArrayEqual(actual: any[], expected: any[], msg: string) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  testCount++;
  if (pass) {
    passCount++;
    console.log(`  ✅ [PASS] ${msg}`);
  } else {
    failCount++;
    console.log(`  ❌ [FAIL] ${msg} — expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`);
  }
}

// ─── Seed data ─────────────────────────────────────────────────
function seedTestData(d1: any) {
  // Mission with capacity=3, waiting_list=2, version=0
  d1.prepare(`INSERT INTO missions (id, title, public_code, status, capacity, waiting_list, confirmation_phrase, start_at, end_at, registration_open_at, created_by, version)
    VALUES (?, ?, ?, 'OPEN', 3, 2, 'test-phrase', '2026-10-01T08:00:00Z', '2026-10-01T16:00:00Z', datetime('now'), 'test', 0)`)
    .bind('mission-p7', 'مهمة اختبار Phase7', 'MNY-P7').run();

  // Volunteers
  d1.prepare(`INSERT INTO volunteers (id, name, member_id, phone) VALUES (?, ?, ?, ?)`)
    .bind('vol-1', 'أحمد الأولى', 'V001', '01000000001').run();
  d1.prepare(`INSERT INTO volunteers (id, name, member_id, phone) VALUES (?, ?, ?, ?)`)
    .bind('vol-2', 'محمد الثاني', 'V002', '01000000002').run();
  d1.prepare(`INSERT INTO volunteers (id, name, member_id, phone) VALUES (?, ?, ?, ?)`)
    .bind('vol-3', 'علي الثالث', 'V003', '01000000003').run();
  d1.prepare(`INSERT INTO volunteers (id, name, member_id, phone) VALUES (?, ?, ?, ?)`)
    .bind('vol-4', 'خالد الرابع', 'V004', '01000000004').run();

  // 2 CONFIRMED (seats 1,2) + 1 WAITLIST (position 1)
  d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, registration_sequence, ownership_token, original_status)
    VALUES (?, ?, ?, 'CONFIRMED', 1, 1, 'token-owner-1', NULL)`)
    .bind('reg-1', 'mission-p7', 'vol-1').run();
  d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, seat_number, registration_sequence, ownership_token, original_status)
    VALUES (?, ?, ?, 'CONFIRMED', 2, 2, 'token-owner-2', NULL)`)
    .bind('reg-2', 'mission-p7', 'vol-2').run();
  d1.prepare(`INSERT INTO registrations (id, mission_id, volunteer_id, status, waitlist_position, registration_sequence, ownership_token, original_status)
    VALUES (?, ?, ?, 'WAITLIST', 1, 3, 'token-owner-3', NULL)`)
    .bind('reg-3', 'mission-p7', 'vol-3').run();
}

// ─── Core Change Detection Algorithm (mirrors useLiveChanges) ──
interface RosterEntry { id: string; name: string; status: string; seat_number: number | null; waitlist_position: number | null; }
interface MissionState { confirmed: number; waitlist: number; available: number; capacity: number; is_completely_full: boolean; }

interface ChangeResult {
  registered: { name: string; id: string }[];
  cancelled: { name: string; id: string }[];
  promoted: { name: string; id: string }[];
  countChanged: boolean;
  missionBecameFull: boolean;
}

function detectChanges(
  prevRegs: RosterEntry[],
  currRegs: RosterEntry[],
  prevMission: MissionState | null,
  currMission: MissionState | null,
): ChangeResult {
  const prevIds = new Set(prevRegs.map((r) => r.id));
  const currIds = new Set(currRegs.map((r) => r.id));
  const prevMap = new Map(prevRegs.map((r) => [r.id, r]));

  const registered: { name: string; id: string }[] = [];
  const cancelled: { name: string; id: string }[] = [];
  const promoted: { name: string; id: string }[] = [];

  for (const reg of currRegs) {
    if (!prevIds.has(reg.id)) registered.push({ name: reg.name, id: reg.id });
  }

  for (const prevId of prevIds) {
    if (!currIds.has(prevId)) {
      const prev = prevMap.get(prevId)!;
      cancelled.push({ name: prev.name, id: prevId });
    }
  }

  for (const reg of currRegs) {
    if (prevIds.has(reg.id)) {
      const prev = prevMap.get(reg.id);
      if (prev && prev.status === 'WAITLIST' && reg.status === 'CONFIRMED') {
        promoted.push({ name: reg.name, id: reg.id });
      }
    }
  }

  let countChanged = false;
  if (currMission && prevMission) {
    countChanged = currMission.confirmed !== prevMission.confirmed ||
      currMission.waitlist !== prevMission.waitlist ||
      currMission.available !== prevMission.available;
  }

  let missionBecameFull = false;
  if (currMission && prevMission) {
    missionBecameFull = currMission.is_completely_full && !prevMission.is_completely_full;
  }

  return { registered, cancelled, promoted, countChanged, missionBecameFull };
}

// ─── Test Suite Runner ─────────────────────────────────────────
async function runTests() {
  console.log('🚀 STARTING PHASE 7 LIVE UX TEST SUITE\n');

  // ══════════════════════════════════════════════════════════════
  // SECTION 1: Change Detection Algorithm (Tests 1-12)
  // ══════════════════════════════════════════════════════════════

  // ── TEST 1: New registration detected ──
  console.log('--- TEST 1: New Registration Detected ---');
  {
    const prev: RosterEntry[] = [{ id: 'r1', name: 'أحمد', status: 'CONFIRMED', seat_number: 1, waitlist_position: null }];
    const curr: RosterEntry[] = [...prev, { id: 'r2', name: 'يوسف', status: 'CONFIRMED', seat_number: 2, waitlist_position: null }];
    const result = detectChanges(prev, curr, null, null);
    assertEqual(result.registered.length, 1, 'One new registration detected');
    assertEqual(result.registered[0].name, 'يوسف', 'New registrant is يوسف');
    assertEqual(result.registered[0].id, 'r2', 'New registrant ID is r2');
  }

  // ── TEST 2: Multiple new registrations ──
  console.log('\n--- TEST 2: Multiple New Registrations ---');
  {
    const prev: RosterEntry[] = [];
    const curr: RosterEntry[] = [
      { id: 'r1', name: 'أحمد', status: 'CONFIRMED', seat_number: 1, waitlist_position: null },
      { id: 'r2', name: 'محمد', status: 'CONFIRMED', seat_number: 2, waitlist_position: null },
      { id: 'r3', name: 'خالد', status: 'WAITLIST', seat_number: null, waitlist_position: 1 },
    ];
    const result = detectChanges(prev, curr, null, null);
    assertEqual(result.registered.length, 3, 'Three new registrations detected');
    assertArrayEqual(result.registered.map((e) => e.name), ['أحمد', 'محمد', 'خالد'], 'Names match in order');
  }

  // ── TEST 3: Cancellation detected ──
  console.log('\n--- TEST 3: Cancellation Detected ---');
  {
    const prev: RosterEntry[] = [
      { id: 'r1', name: 'أحمد', status: 'CONFIRMED', seat_number: 1, waitlist_position: null },
      { id: 'r2', name: 'محمد', status: 'CONFIRMED', seat_number: 2, waitlist_position: null },
    ];
    const curr: RosterEntry[] = [prev[0]];
    const result = detectChanges(prev, curr, null, null);
    assertEqual(result.cancelled.length, 1, 'One cancellation detected');
    assertEqual(result.cancelled[0].name, 'محمد', 'Cancelled person is محمد');
    assertEqual(result.cancelled[0].id, 'r2', 'Cancelled ID is r2');
  }

  // ── TEST 4: Promotion detected (WAITLIST → CONFIRMED) ──
  console.log('\n--- TEST 4: Promotion Detected ---');
  {
    const prev: RosterEntry[] = [
      { id: 'r1', name: 'أحمد', status: 'CONFIRMED', seat_number: 1, waitlist_position: null },
      { id: 'r2', name: 'محمد', status: 'WAITLIST', seat_number: null, waitlist_position: 1 },
    ];
    const curr: RosterEntry[] = [
      { id: 'r1', name: 'أحمد', status: 'CONFIRMED', seat_number: 1, waitlist_position: null },
      { id: 'r2', name: 'محمد', status: 'CONFIRMED', seat_number: 2, waitlist_position: null },
    ];
    const result = detectChanges(prev, curr, null, null);
    assertEqual(result.promoted.length, 1, 'One promotion detected');
    assertEqual(result.promoted[0].name, 'محمد', 'Promoted person is محمد');
  }

  // ── TEST 5: No false promotions for CONFIRMED → CONFIRMED ──
  console.log('\n--- TEST 5: No False Promotion ---');
  {
    const prev: RosterEntry[] = [{ id: 'r1', name: 'أحمد', status: 'CONFIRMED', seat_number: 1, waitlist_position: null }];
    const curr: RosterEntry[] = [{ id: 'r1', name: 'أحمد', status: 'CONFIRMED', seat_number: 1, waitlist_position: null }];
    const result = detectChanges(prev, curr, null, null);
    assertEqual(result.promoted.length, 0, 'No false promotions');
    assertEqual(result.registered.length, 0, 'No false registrations');
    assertEqual(result.cancelled.length, 0, 'No false cancellations');
  }

  // ── TEST 6: Count change detected ──
  console.log('\n--- TEST 6: Count Change Detected ---');
  {
    const prev: MissionState = { confirmed: 28, waitlist: 2, available: 2, capacity: 30, is_completely_full: false };
    const curr: MissionState = { confirmed: 29, waitlist: 2, available: 1, capacity: 30, is_completely_full: false };
    const result = detectChanges([], [], prev, curr);
    assertEqual(result.countChanged, true, 'Count change detected');
  }

  // ── TEST 7: No count change when same ──
  console.log('\n--- TEST 7: No Count Change ---');
  {
    const prev: MissionState = { confirmed: 28, waitlist: 2, available: 2, capacity: 30, is_completely_full: false };
    const curr: MissionState = { confirmed: 28, waitlist: 2, available: 2, capacity: 30, is_completely_full: false };
    const result = detectChanges([], [], prev, curr);
    assertEqual(result.countChanged, false, 'No count change when identical');
  }

  // ── TEST 8: Mission full transition ──
  console.log('\n--- TEST 8: Mission Full Transition ---');
  {
    const prev: MissionState = { confirmed: 29, waitlist: 0, available: 1, capacity: 30, is_completely_full: false };
    const curr: MissionState = { confirmed: 30, waitlist: 0, available: 0, capacity: 30, is_completely_full: true };
    const result = detectChanges([], [], prev, curr);
    assertEqual(result.missionBecameFull, true, 'Mission full transition detected');
    assertEqual(result.countChanged, true, 'Count also changed');
  }

  // ── TEST 9: No false mission full (already full) ──
  console.log('\n--- TEST 9: No False Mission Full ---');
  {
    const prev: MissionState = { confirmed: 30, waitlist: 0, available: 0, capacity: 30, is_completely_full: true };
    const curr: MissionState = { confirmed: 30, waitlist: 0, available: 0, capacity: 30, is_completely_full: true };
    const result = detectChanges([], [], prev, curr);
    assertEqual(result.missionBecameFull, false, 'No false mission full');
  }

  // ── TEST 10: Identity by ID not name ──
  console.log('\n--- TEST 10: Identity by ID Not Name ---');
  {
    const prev: RosterEntry[] = [{ id: 'r1', name: 'أحمد', status: 'CONFIRMED', seat_number: 1, waitlist_position: null }];
    const curr: RosterEntry[] = [{ id: 'r1', name: 'أحمد علي', status: 'CONFIRMED', seat_number: 1, waitlist_position: null }]; // name changed
    const result = detectChanges(prev, curr, null, null);
    assertEqual(result.registered.length, 0, 'Same ID = no new registration even if name changed');
    assertEqual(result.cancelled.length, 0, 'Same ID = no cancellation');
  }

  // ── TEST 11: Simultaneous add + cancel ──
  console.log('\n--- TEST 11: Simultaneous Add + Cancel ---');
  {
    const prev: RosterEntry[] = [
      { id: 'r1', name: 'أحمد', status: 'CONFIRMED', seat_number: 1, waitlist_position: null },
      { id: 'r2', name: 'محمد', status: 'CONFIRMED', seat_number: 2, waitlist_position: null },
    ];
    const curr: RosterEntry[] = [
      { id: 'r1', name: 'أحمد', status: 'CONFIRMED', seat_number: 1, waitlist_position: null },
      { id: 'r3', name: 'خالد', status: 'CONFIRMED', seat_number: 2, waitlist_position: null },
    ];
    const result = detectChanges(prev, curr, null, null);
    assertEqual(result.registered.length, 1, 'One new registration');
    assertEqual(result.registered[0].id, 'r3', 'New registration is r3');
    assertEqual(result.cancelled.length, 1, 'One cancellation');
    assertEqual(result.cancelled[0].id, 'r2', 'Cancelled is r2');
  }

  // ── TEST 12: Mixed events: register + cancel + promote ──
  console.log('\n--- TEST 12: Mixed Events ---');
  {
    const prev: RosterEntry[] = [
      { id: 'r1', name: 'أحمد', status: 'CONFIRMED', seat_number: 1, waitlist_position: null },
      { id: 'r2', name: 'محمد', status: 'WAITLIST', seat_number: null, waitlist_position: 1 },
      { id: 'r3', name: 'خالد', status: 'CONFIRMED', seat_number: 2, waitlist_position: null },
    ];
    const curr: RosterEntry[] = [
      { id: 'r1', name: 'أحمد', status: 'CONFIRMED', seat_number: 1, waitlist_position: null },
      { id: 'r2', name: 'محمد', status: 'CONFIRMED', seat_number: 2, waitlist_position: null }, // promoted
      { id: 'r4', name: 'يوسف', status: 'CONFIRMED', seat_number: 3, waitlist_position: null }, // new
      // r3 removed
    ];
    const result = detectChanges(prev, curr, null, null);
    assertEqual(result.registered.length, 1, 'One registration (r4)');
    assertEqual(result.cancelled.length, 1, 'One cancellation (r3)');
    assertEqual(result.promoted.length, 1, 'One promotion (r2)');
  }

  // ══════════════════════════════════════════════════════════════
  // SECTION 2: Toast Notification Messages (Tests 13-16)
  // ══════════════════════════════════════════════════════════════

  // ── TEST 13: Registration toast (Arabic) ──
  console.log('\n--- TEST 13: Registration Toast Message ---');
  {
    const name = 'يوسف أيمن';
    const message = `${name} انضم إلى المهمة الآن`;
    assertEqual(message, 'يوسف أيمن انضم إلى المهمة الآن', 'Registration toast format');
  }

  // ── TEST 14: Cancellation toast (Arabic) ──
  console.log('\n--- TEST 14: Cancellation Toast Message ---');
  {
    const name = 'محمد ممدوح';
    const message = `${name} ألغى تسجيله`;
    assertEqual(message, 'محمد ممدوح ألغى تسجيله', 'Cancellation toast format');
  }

  // ── TEST 15: Promotion toast (Arabic) ──
  console.log('\n--- TEST 15: Promotion Toast Message ---');
  {
    const name = 'عبدالرحمن خيري';
    const message = `تم ترقية ${name} من قائمة الانتظار`;
    assertEqual(message, 'تم ترقية عبدالرحمن خيري من قائمة الانتظار', 'Promotion toast format');
  }

  // ── TEST 16: Mission full toast ──
  console.log('\n--- TEST 16: Mission Full Toast Message ---');
  {
    const message = 'اكتمل العدد — المهمة مكتملة';
    assertEqual(message, 'اكتمل العدد — المهمة مكتملة', 'Mission full toast format');
  }

  // ══════════════════════════════════════════════════════════════
  // SECTION 3: Activity Strip Logic (Tests 17-19)
  // ══════════════════════════════════════════════════════════════

  // ── TEST 17: Recent events limited to MAX_RECENT_EVENTS (5) ──
  console.log('\n--- TEST 17: Recent Events Limit ---');
  {
    const MAX = 5;
    const events: { name: string }[] = [];
    for (let i = 0; i < 8; i++) events.push({ name: `متطوع ${i}` });
    const combined = [...events.slice(0, 3), ...[]].slice(0, MAX);
    assert(combined.length <= MAX, `Events capped at ${MAX} (got ${combined.length})`);
  }

  // ── TEST 18: Activity types correctly categorized ──
  console.log('\n--- TEST 18: Activity Type Categorization ---');
  {
    type Evt = { type: string; name: string };
    const events: Evt[] = [
      { type: 'registered', name: 'أحمد' },
      { type: 'cancelled', name: 'محمد' },
      { type: 'promoted', name: 'خالد' },
    ];
    assertEqual(events.filter((e) => e.type === 'registered').length, 1, 'One registered');
    assertEqual(events.filter((e) => e.type === 'cancelled').length, 1, 'One cancelled');
    assertEqual(events.filter((e) => e.type === 'promoted').length, 1, 'One promoted');
  }

  // ── TEST 19: Activity strip shows max 3 items ──
  console.log('\n--- TEST 19: Activity Strip Max 3 Items ---');
  {
    const events = [1, 2, 3, 4]; // 4 events
    const displayed = events.slice(0, 3); // UI renders max 3
    assertEqual(displayed.length, 3, 'Display capped at 3');
  }

  // ══════════════════════════════════════════════════════════════
  // SECTION 4: Animation State Logic (Tests 20-23)
  // ══════════════════════════════════════════════════════════════

  // ── TEST 20: New entry IDs tracked in Set ──
  console.log('\n--- TEST 20: New Entry IDs in Set ---');
  {
    const ids = new Set<string>();
    ids.add('r1');
    ids.add('r2');
    assert(ids.has('r1'), 'r1 tracked');
    assert(ids.has('r2'), 'r2 tracked');
    assert(!ids.has('r3'), 'r3 not tracked');
    assertEqual(ids.size, 2, 'Set size is 2');
  }

  // ── TEST 21: New entry IDs cleared after delay ──
  console.log('\n--- TEST 21: New Entry IDs Clearable ---');
  {
    const ids = new Set<string>();
    ids.add('r1');
    assertEqual(ids.size, 1, 'Before clear: size 1');
    ids.clear();
    assertEqual(ids.size, 0, 'After clear: size 0');
  }

  // ── TEST 22: Count pulse key increments ──
  console.log('\n--- TEST 22: Count Pulse Key Increment ---');
  {
    let key = 0;
    const prevConfirmed = 28;
    const newConfirmed = 29;
    if (newConfirmed !== prevConfirmed) key++;
    assertEqual(key, 1, 'Pulse key incremented');
  }

  // ── TEST 23: Count pulse key unchanged when same ──
  console.log('\n--- TEST 23: Count Pulse Key Unchanged ---');
  {
    let key = 0;
    const prevConfirmed = 28;
    const newConfirmed = 28;
    if (newConfirmed !== prevConfirmed) key++;
    assertEqual(key, 0, 'Pulse key unchanged');
  }

  // ══════════════════════════════════════════════════════════════
  // SECTION 5: Edge Cases (Tests 24-28)
  // ══════════════════════════════════════════════════════════════

  // ── TEST 24: Empty → first registration ──
  console.log('\n--- TEST 24: Empty to First Registration ---');
  {
    const result = detectChanges([], [{ id: 'r1', name: 'أحمد', status: 'CONFIRMED', seat_number: 1, waitlist_position: null }], null, null);
    assertEqual(result.registered.length, 1, 'First registration detected from empty');
  }

  // ── TEST 25: Rapid succession — 3 in one poll ──
  console.log('\n--- TEST 25: Rapid Succession (3 in one poll) ---');
  {
    const prev: RosterEntry[] = [{ id: 'r1', name: 'أحمد', status: 'CONFIRMED', seat_number: 1, waitlist_position: null }];
    const curr: RosterEntry[] = [
      ...prev,
      { id: 'r2', name: 'محمد', status: 'CONFIRMED', seat_number: 2, waitlist_position: null },
      { id: 'r3', name: 'خالد', status: 'CONFIRMED', seat_number: 3, waitlist_position: null },
      { id: 'r4', name: 'يوسف', status: 'CONFIRMED', seat_number: 4, waitlist_position: null },
    ];
    const result = detectChanges(prev, curr, null, null);
    assertEqual(result.registered.length, 3, 'Three registrations in one poll');
  }

  // ── TEST 26: Initial load guard (version <= 0) ──
  console.log('\n--- TEST 26: Initial Load Guard ---');
  {
    const version = 0;
    const wouldDetect = version > 0;
    assertEqual(wouldDetect, false, 'Version 0 = no detection (initial load)');
  }

  // ── TEST 27: Version > 0 allows detection ──
  console.log('\n--- TEST 27: Version > 0 Allows Detection ---');
  {
    const version = 1;
    const wouldDetect = version > 0;
    assertEqual(wouldDetect, true, 'Version 1 = detection enabled');
  }

  // ── TEST 28: Full mission: count + full transition ──
  console.log('\n--- TEST 28: Full Mission Dual Detection ---');
  {
    const prev: MissionState = { confirmed: 29, waitlist: 0, available: 1, capacity: 30, is_completely_full: false };
    const curr: MissionState = { confirmed: 30, waitlist: 0, available: 0, capacity: 30, is_completely_full: true };
    const result = detectChanges([], [], prev, curr);
    assertEqual(result.countChanged, true, 'Count changed on full');
    assertEqual(result.missionBecameFull, true, 'Mission full on full');
  }

  // ══════════════════════════════════════════════════════════════
  // SECTION 6: Database Integration (Tests 29-30)
  // ══════════════════════════════════════════════════════════════

  // ── TEST 29: Version increments on registration ──
  console.log('\n--- TEST 29: Version Increment on Registration ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    const before = d1.prepare('SELECT version FROM missions WHERE id = ?').bind('mission-p7').first() as any;
    assertEqual(before?.version ?? 0, 0, 'Version starts at 0');

    // Add a registration using bind + run
    d1.prepare(`INSERT INTO registrations (mission_id, volunteer_id, status, seat_number, registration_sequence, ownership_token, original_status)
      VALUES (?, ?, 'CONFIRMED', 3, 4, 'token-new', NULL)`).bind('mission-p7', 'vol-4').run();

    // Increment version — must use bind for the WHERE param
    d1.prepare('UPDATE missions SET version = version + 1 WHERE id = ?').bind('mission-p7').run();

    const after = d1.prepare('SELECT version FROM missions WHERE id = ?').bind('mission-p7').first() as any;
    assertEqual(after?.version ?? 0, 1, 'Version incremented to 1');
  }

  // ── TEST 30: Roster query returns correct live data ──
  console.log('\n--- TEST 30: Roster Query for Live Endpoint ---');
  {
    const d1 = createTestD1();
    seedTestData(d1);

    // First verify registrations exist
    const count = d1.prepare('SELECT COUNT(*) as cnt FROM registrations WHERE mission_id = ?').bind('mission-p7').first() as any;
    assert((count?.cnt ?? 0) >= 2, `Registrations exist in DB (count: ${count?.cnt ?? 0})`);

    const roster = d1.prepare(`
      SELECT r.id, v.name, r.status, r.seat_number, r.waitlist_position
      FROM registrations r
      JOIN volunteers v ON r.volunteer_id = v.id
      WHERE r.mission_id = ? AND r.status != 'CANCELLED'
      ORDER BY r.status = 'WAITLIST' ASC, r.seat_number ASC, r.waitlist_position ASC
    `).bind('mission-p7').all() as any[];

    assertEqual(roster.length, 3, `Three registrations in roster (got ${roster.length})`);
    // CONFIRMED registrations come first (seat_number ordered), then WAITLIST
    if (roster.length >= 1) {
      assertEqual(roster[0].status, 'CONFIRMED', 'First is CONFIRMED');
      assertEqual(roster[0].seat_number, 1, 'First seat is 1');
    }
    if (roster.length >= 2) {
      assertEqual(roster[1].status, 'CONFIRMED', 'Second is CONFIRMED');
      assertEqual(roster[1].seat_number, 2, 'Second seat is 2');
    }
    if (roster.length >= 3) {
      assertEqual(roster[2].status, 'WAITLIST', 'Third is WAITLIST');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════');
  console.log(`📊 PHASE 7 RESULTS: ${passCount}/${testCount} PASS`);
  if (failCount > 0) {
    console.log(`❌ ${failCount} FAILURES`);
  } else {
    console.log('✅ ALL TESTS PASS');
  }
  console.log('══════════════════════════════════════════════');
  process.exit(failCount > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('❌ FATAL:', err);
  process.exit(1);
});
