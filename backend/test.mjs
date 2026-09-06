const API = 'http://localhost:8787';

async function testMissionCreation() {
  console.log('1. Login...');
  const loginRes = await fetch(`${API}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const loginData = await loginRes.json();
  console.log('Login result:', loginData.success ? 'OK' : 'FAIL');
  
  const cookie = loginRes.headers.get('set-cookie');
  console.log('Cookie:', cookie ? 'YES' : 'NO');
  
  if (!cookie) {
    console.log('No cookie, stopping test');
    return;
  }

  const cookieValue = cookie.split(';')[0];
  console.log('Cookie value:', cookieValue);

  console.log('\n2. Create mission...');
  const createRes = await fetch(`${API}/api/admin/missions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieValue,
    },
    body: JSON.stringify({
      title: 'Prosthetic Limbs Campaign',
      description: 'Test mission for prosthetic limbs distribution',
      location: 'Minya General Hospital',
      start_at: '2026-09-16T08:00:00Z',
      end_at: '2026-09-17T18:00:00Z',
      capacity: 10,
    }),
  });
  console.log('Create status:', createRes.status);
  const createData = await createRes.json();
  console.log('Create result:', JSON.stringify(createData, null, 2));

  if (createData.success) {
    const missionId = createData.data.id;

    console.log('\n3. List missions...');
    const listRes = await fetch(`${API}/api/admin/missions`, {
      headers: { Cookie: cookieValue },
    });
    const listData = await listRes.json();
    console.log('List result:', JSON.stringify(listData, null, 2));
  }
}

testMissionCreation().catch(console.error);
