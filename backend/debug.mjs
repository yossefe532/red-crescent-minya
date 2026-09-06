// Debug mission creation step by step
const API = 'http://localhost:8787';

async function debug() {
  console.log('1. Testing admin login...');
  const loginRes = await fetch(`${API}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  console.log('Login status:', loginRes.status);
  const loginData = await loginRes.json();
  console.log('Login response:', JSON.stringify(loginData, null, 2));
  
  const cookie = loginRes.headers.get('set-cookie');
  console.log('Cookie received:', cookie ? 'YES' : 'NO');
  
  if (!cookie) return;
  
  const cookieValue = cookie.split(';')[0];
  
  console.log('\n2. Testing mission creation with minimal data...');
  const createRes = await fetch(`${API}/api/admin/missions`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json', 
      Cookie: cookieValue 
    },
    body: JSON.stringify({
      title: 'Test Mission',
      capacity: 5,
      start_at: '2026-09-16T08:00:00Z',
      end_at: '2026-09-17T18:00:00Z',
    }),
  });
  console.log('Create status:', createRes.status);
  const createData = await createRes.text();
  console.log('Create response:', createData);
  
  console.log('\n3. Testing mission creation with all required fields...');
  const create2Res = await fetch(`${API}/api/admin/missions`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json', 
      Cookie: cookieValue 
    },
    body: JSON.stringify({
      title: 'Full Test Mission',
      description: 'Test description',
      location: 'Minya',
      start_at: '2026-09-16T08:00:00Z',
      end_at: '2026-09-17T18:00:00Z',
      capacity: 10,
    }),
  });
  console.log('Create2 status:', create2Res.status);
  const create2Data = await create2Res.text();
  console.log('Create2 response:', create2Data);
}

debug().catch(console.error);