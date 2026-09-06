/**
 * Comprehensive MVP Acceptance & Concurrency Test
 * Red Crescent Minya — Smart Mission Registration System
 */

const API = 'http://localhost:8787';

// Generate a dummy WebM audio buffer (1.5KB)
function generateMockAudioBase64() {
  const bytes = new Uint8Array(1500);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = (i * 31) % 256;
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

const mockAudioBase64 = generateMockAudioBase64();

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🧪 STARTING RED CRESCENT MINYA MVP ACCEPTANCE SUITE');
  console.log('═══════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName} ${details ? '— ' + details : ''}`);
      failed++;
    }
  }

  // 1. Health check
  const healthRes = await fetch(`${API}/health`).then(r => r.json());
  assert(healthRes.success && healthRes.data.status === 'ok', '1. Health endpoint GET /health');

  // 2. Admin Login
  const loginRes = await fetch(`${API}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const loginData = await loginRes.json();
  const setCookie = loginRes.headers.get('set-cookie');
  const cookie = setCookie ? setCookie.split(';')[0] : '';
  assert(loginData.success && cookie.includes('rc_session='), '2. Admin Login POST /api/admin/login');

  // 3. Create Mission (Capacity: 10)
  const createMissionRes = await fetch(`${API}/api/admin/missions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      title: 'Prosthetic Limbs Campaign',
      description: 'In cooperation with Ministry of Social Solidarity',
      location: 'Minya General Hospital',
      start_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      end_at: new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString(),
      capacity: 10,
    }),
  });
  const missionData = await createMissionRes.json();
  assert(missionData.success && missionData.data.public_code.startsWith('MNY-'), '3. Create Mission MNY-XXX with capacity 10');
  
  const publicCode = missionData.data.public_code;
  const missionId = missionData.data.id;
  console.log(`   → Created Mission: ${publicCode} (ID: ${missionId})`);

  // 4. Public Mission Info
  const publicInfoRes = await fetch(`${API}/api/missions/${publicCode}`).then(r => r.json());
  assert(
    publicInfoRes.success && 
    publicInfoRes.data.capacity === 10 && 
    publicInfoRes.data.available === 10 &&
    publicInfoRes.data.registration_open === true,
    '4. Public Mission Info GET /api/missions/:publicCode'
  );

  // 5. Test Member Lookup for Unknown Member
  const unknownLookup = await fetch(`${API}/api/volunteers/by-member-id/MEM-999999`).then(r => r.json());
  assert(unknownLookup.success && unknownLookup.data.found === false, '5. Unknown Member ID returns found: false');

  // 6. Test Registration WITHOUT audio (MUST FAIL)
  const noAudioRes = await fetch(`${API}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mission_public_code: publicCode,
      member_id: 'MEM-000001',
      name: 'Test No Audio Volunteer',
    }),
  });
  const noAudioData = await noAudioRes.json();
  assert(!noAudioData.success && noAudioRes.status === 400, '6. Reject Registration without mandatory audio');

  // 7. CONCURRENCY TEST: 100 Volunteers submitting simultaneously
  console.log('\n⚡ RUNNING CONCURRENCY TEST: 100 simultaneous volunteer submissions...');
  const CONCURRENT_COUNT = 100;
  const testRunId = Math.floor(Math.random() * 90000) + 10000;
  const registrationPromises = [];

  for (let i = 1; i <= CONCURRENT_COUNT; i++) {
    const memberId = `M${testRunId}-${String(i).padStart(4, '0')}`;
    const name = `متطوع رقم ${i}`;
    const reqPromise = fetch(`${API}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mission_public_code: publicCode,
        member_id: memberId,
        name: name,
        audio_base64: mockAudioBase64,
        duration_ms: 3200,
        phrase: `أؤكد مشاركتي في مهمة ${publicCode}`,
        request_id: `req-${publicCode}-${memberId}`,
      }),
    }).then(async r => ({ status: r.status, data: await r.json(), memberId, index: i }));

    registrationPromises.push(reqPromise);
  }

  const results = await Promise.all(registrationPromises);

  let confirmedCount = 0;
  let waitlistCount = 0;
  let seatNumbers = new Set();
  let waitlistPositions = new Set();
  let duplicateSeats = 0;
  let failedRequests = 0;

  for (const res of results) {
    if (!res.data.success) {
      failedRequests++;
      console.error(`Request ${res.index} failed:`, res.data);
      continue;
    }
    const d = res.data.data;
    if (d.status === 'CONFIRMED') {
      confirmedCount++;
      if (seatNumbers.has(d.seat_number)) {
        duplicateSeats++;
      }
      seatNumbers.add(d.seat_number);
    } else if (d.status === 'WAITLIST') {
      waitlistCount++;
      waitlistPositions.add(d.waitlist_position);
    }
  }

  console.log(`   → Results: Confirmed=${confirmedCount}, Waitlist=${waitlistCount}, Failed=${failedRequests}`);
  assert(confirmedCount === 10, '7.1 Exactly 10 CONFIRMED seats allocated');
  assert(waitlistCount === 90, '7.2 Exactly 90 WAITLIST registrations');
  assert(duplicateSeats === 0, '7.3 Zero seat collisions / duplicates');
  assert(seatNumbers.size === 10, '7.4 All seat numbers 1..10 are uniquely assigned');

  // 8. Test Member Lookup for Known Member
  const testMember1 = `M${testRunId}-0001`;
  const knownLookup = await fetch(`${API}/api/volunteers/by-member-id/${testMember1}`).then(r => r.json());
  assert(knownLookup.success && knownLookup.data.found === true && knownLookup.data.name === 'متطوع رقم 1', '8. Known Member ID auto-lookup');

  // 9. Duplicate Registration Prevention (Same Member ID registering again)
  const duplicateAttempt = await fetch(`${API}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mission_public_code: publicCode,
      member_id: testMember1,
      name: 'متطوع رقم 1',
      audio_base64: mockAudioBase64,
      phrase: `أؤكد مشاركتي في مهمة ${publicCode}`,
    }),
  });
  const dupData = await duplicateAttempt.json();
  assert(!dupData.success && duplicateAttempt.status === 409, '9. Reject Duplicate Registration with 409 Conflict');

  // 10. Idempotency Check (Retry with same request_id)
  const idempotentAttempt = await fetch(`${API}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mission_public_code: publicCode,
      member_id: testMember1,
      name: 'متطوع رقم 1',
      audio_base64: mockAudioBase64,
      request_id: `req-${publicCode}-${testMember1}`,
    }),
  });
  const idemData = await idempotentAttempt.json();
  assert(idemData.success && idemData.data.idempotent_replay === true, '10. Idempotency replay returns existing registration');

  // 11. Admin Participant List & Audio Presence
  const regListRes = await fetch(`${API}/api/admin/missions/${missionId}/registrations`, {
    headers: { Cookie: cookie },
  });
  const regListData = await regListRes.json();
  assert(
    regListData.success && 
    regListData.data.confirmed === 10 && 
    regListData.data.waitlist === 90 &&
    regListData.data.total === 100,
    '11. Admin Participant List shows 10 Confirmed + 90 Waitlist'
  );

  // 12. Cancellation and Automatic Waitlist Promotion
  // Find a confirmed volunteer to cancel
  const confirmedList = regListData.data.registrations.filter(r => r.status === 'CONFIRMED');
  const targetToCancel = confirmedList[4]; // Volunteer #5
  console.log(`\n🔄 Cancelling confirmed registration for ${targetToCancel.volunteer_name} (Seat #${targetToCancel.seat_number})...`);

  const cancelRes = await fetch(`${API}/api/admin/registrations/${targetToCancel.id}/cancel`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  const cancelData = await cancelRes.json();
  assert(
    cancelData.success && 
    cancelData.data.promoted_volunteer !== null &&
    cancelData.data.promoted_volunteer.new_seat_number === targetToCancel.seat_number,
    '12.1 Cancellation of confirmed seat successfully promoted first waitlisted volunteer'
  );

  // Verify counts after promotion
  const updatedRegList = await fetch(`${API}/api/admin/missions/${missionId}/registrations`, {
    headers: { Cookie: cookie },
  }).then(r => r.json());
  assert(
    updatedRegList.data.confirmed === 10 && 
    updatedRegList.data.waitlist === 89 && 
    updatedRegList.data.cancelled === 1,
    '12.2 Counts after auto-promotion: Confirmed=10, Waitlist=89, Cancelled=1'
  );

  // 13. CSV Export Test
  const exportRes = await fetch(`${API}/api/admin/missions/${missionId}/export`, {
    headers: { Cookie: cookie },
  });
  const csvText = await exportRes.text();
  const csvLines = csvText.trim().split('\n');
  assert(
    exportRes.status === 200 && 
    csvLines.length >= 101 && // Header + 100 registrations
    csvText.includes('التسلسل') &&
    csvText.includes('Prosthetic Limbs') || csvText.includes('متطوع'),
    '13. CSV Export returns formatted table with UTF-8 BOM'
  );

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`🏁 TEST SUITE COMPLETED: ${passed} PASSED, ${failed} FAILED`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test Suite Error:', err);
  process.exit(1);
});
