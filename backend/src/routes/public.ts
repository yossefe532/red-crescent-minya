import { Hono } from 'hono';
import { Env } from '../env';
import { success, Errors } from '../utils/response';
import { getOwnershipToken } from '../middleware/ownership';

const publicRoutes = new Hono<{ Bindings: Env }>();

// Simple in-memory rate limiter per IP / Member ID
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxRequests = 20, windowMs = 60000): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  
  if (entry.count >= maxRequests) {
    return false;
  }
  
  entry.count++;
  return true;
}

// GET /api/missions/:publicCode
publicRoutes.get('/missions/:publicCode', async (c) => {
  try {
    const publicCode = c.req.param('publicCode');
    
    const result = await c.env.DB.prepare(`
      SELECT id, public_code, title, description, location, 
             start_at, end_at, capacity, confirmation_phrase, status,
             registration_open_at, registration_close_at, waiting_list
      FROM missions 
      WHERE public_code = ?
    `).bind(publicCode).first();

    if (!result) {
      return Errors.notFound(c, 'Mission');
    }

    const mission = result as any;
    
    // Get current registration counts
    const counts = await c.env.DB.prepare(`
      SELECT 
        COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed,
        COUNT(CASE WHEN status = 'WAITLIST' THEN 1 END) as waitlist
      FROM registrations 
      WHERE mission_id = ?
    `).bind(mission.id).first();

    const countsData = counts as any;
    const confirmedCount = countsData?.confirmed || 0;
    const waitlistCount = countsData?.waitlist || 0;
    
    // Check if registration is currently open
    const now = new Date().toISOString();
    const registrationOpen = mission.registration_open_at ? now >= mission.registration_open_at : true;
    const registrationClosed = mission.registration_close_at ? now >= mission.registration_close_at : false;
    
    const isOpen = mission.status === 'OPEN' && registrationOpen && !registrationClosed;

    return success(c, {
      id: mission.id,
      public_code: mission.public_code,
      title: mission.title,
      description: mission.description,
      location: mission.location,
      start_at: mission.start_at,
      end_at: mission.end_at,
      capacity: mission.capacity,
      confirmation_phrase: mission.confirmation_phrase,
      status: mission.status,
      confirmed: confirmedCount,
      waitlist: waitlistCount,
      available: Math.max(0, mission.capacity - confirmedCount),
      is_full: confirmedCount >= mission.capacity,
      is_completely_full: confirmedCount >= mission.capacity && (waitlistCount >= (mission.waiting_list || 0) || !mission.waiting_list),
      registration_open: isOpen,
    });
  } catch (err: any) {
    console.error('Get mission error:', err);
    return Errors.internal(c);
  }
});

// GET /api/missions/:publicCode/registrations-live — live registration feed
publicRoutes.get('/missions/:publicCode/registrations-live', async (c) => {
  try {
    const publicCode = c.req.param('publicCode');
    
    const mission = await c.env.DB.prepare(
      `SELECT id FROM missions WHERE public_code = ?`
    ).bind(publicCode).first();
    
    if (!mission) {
      return Errors.notFound(c, 'Mission');
    }
    
    const missionData = mission as any;
    
    // Official registrations (with member_id)
    const result = await c.env.DB.prepare(`
      SELECT r.id, v.name, v.member_id, r.status, r.seat_number, 
             r.waitlist_position, r.created_at, 'OFFICIAL' as source
      FROM registrations r
      JOIN volunteers v ON v.id = r.volunteer_id
      WHERE r.mission_id = ?
      ORDER BY r.registration_sequence ASC
      LIMIT 100
    `).bind(missionData.id).all();
    
    // Temporary registrations (without member_id)
    const tempResult = await c.env.DB.prepare(`
      SELECT id, name, NULL as member_id, status, seat_number,
             waitlist_position, created_at, 'TEMP' as source
      FROM temporary_registrations
      WHERE mission_id = ?
      ORDER BY registration_sequence ASC
      LIMIT 50
    `).bind(missionData.id).all();
    
    // Merge + sort by registration_sequence (approximate by created_at within source)
    const allRegs = [
      ...(result.results || []),
      ...(tempResult.results || []),
    ].sort((a: any, b: any) => {
      // Within each source, original order is preserved; interleave by created_at
      return (a.created_at || '').localeCompare(b.created_at || '');
    }).slice(0, 100); // Hard limit
    
    const registrations = allRegs.map((row: any) => ({
      id: row.id,
      name: row.name,
      member_id: row.member_id,
      status: row.status,
      seat_number: row.seat_number,
      waitlist_position: row.waitlist_position,
      created_at: row.created_at,
    }));
    
    return success(c, registrations);
  } catch (err: any) {
    console.error('Live registrations error:', err);
    return Errors.internal(c);
  }
});

// GET /api/missions/:publicCode/status — lightweight status-only endpoint for fast polling
publicRoutes.get('/missions/:publicCode/status', async (c) => {
  try {
    const publicCode = c.req.param('publicCode');
    
    const mission = await c.env.DB.prepare(`
      SELECT id, status, capacity, waiting_list, registration_close_at
      FROM missions WHERE public_code = ?
    `).bind(publicCode).first();

    if (!mission) {
      return Errors.notFound(c, 'Mission');
    }

    const m = mission as any;
    const counts = await c.env.DB.prepare(`
      SELECT 
        COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed,
        COUNT(CASE WHEN status = 'WAITLIST' THEN 1 END) as waitlist
      FROM registrations WHERE mission_id = ?
    `).bind(m.id).first();

    const cd = counts as any;
    const confirmed = cd?.confirmed || 0;
    const waitlist = cd?.waitlist || 0;
    const isFull = confirmed >= m.capacity;
    const isCompletelyFull = isFull && (waitlist >= (m.waiting_list || 0) || !m.waiting_list);
    
    const nowIso = new Date().toISOString();
    const registrationClosed = m.registration_close_at ? nowIso >= m.registration_close_at : false;
    const isOpen = m.status === 'OPEN' && !registrationClosed && !isCompletelyFull;

    return success(c, {
      status: m.status,
      confirmed,
      waitlist,
      is_full: isFull,
      is_completely_full: isCompletelyFull,
      registration_open: isOpen,
    });
  } catch (err) {
    console.error('Status check error:', err);
    return Errors.internal(c);
  }
});

// GET /api/volunteers/by-member-id/:memberId
publicRoutes.get('/volunteers/by-member-id/:memberId', async (c) => {
  try {
    const memberId = c.req.param('memberId').trim();
    
    // Rate limit: 30 requests per minute per member ID / IP
    const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'local';
    const rateLimitKey = `vol_lookup:${clientIp}:${memberId}`;
    
    if (!checkRateLimit(rateLimitKey, 30, 60000)) {
      return Errors.rateLimited(c);
    }

    const volunteer = await c.env.DB.prepare(`
      SELECT name FROM volunteers WHERE member_id = ?
    `).bind(memberId).first();

    if (!volunteer) {
      return success(c, { found: false });
    }

    return success(c, { 
      found: true, 
      name: (volunteer as any).name 
    });
  } catch (err: any) {
    console.error('Get volunteer error:', err);
    return Errors.internal(c);
  }
});

export { publicRoutes };

// ─── Phase 6: Unified Live Endpoint ────────────────────────────
// GET /api/missions/:publicCode/live?since_version=N
//
// Replaces 4 separate polling mechanisms with 1 smart endpoint.
// Uses version-based change detection: if nothing changed, returns
// a minimal { changed: false } response instead of the full payload.
//
// Request headers:
//   X-Ownership-Token — optional, to include my_registrations
//
// Response when unchanged:
//   { success: true, data: { changed: false, version: N } }
//
// Response when changed:
//   { success: true, data: { changed: true, version: N, mission: {...}, registrations: [...], my_registrations: [...] } }

publicRoutes.get('/missions/:publicCode/live', async (c) => {
  try {
    const publicCode = c.req.param('publicCode');
    const sinceVersion = parseInt(c.req.query('since_version') || '-1', 10);

    // 1. Get mission with version
    const mission = await c.env.DB.prepare(`
      SELECT id, public_code, title, description, location,
             start_at, end_at, capacity, confirmation_phrase, status,
             registration_open_at, registration_close_at, waiting_list, version
      FROM missions
      WHERE public_code = ?
    `).bind(publicCode).first();

    if (!mission) {
      return Errors.notFound(c, 'Mission');
    }

    const m = mission as any;
    const currentVersion = m.version || 0;

    // 2. Fast path: no change since last poll
    if (sinceVersion >= 0 && sinceVersion === currentVersion) {
      return success(c, { changed: false, version: currentVersion });
    }

    // 3. Something changed — build full payload
    // 3a. Registration counts
    const counts = await c.env.DB.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed,
        COUNT(CASE WHEN status = 'WAITLIST' THEN 1 END) as waitlist
      FROM registrations
      WHERE mission_id = ?
    `).bind(m.id).first();

    const cd = counts as any;
    const confirmedCount = cd?.confirmed || 0;
    const waitlistCount = cd?.waitlist || 0;

    // 3b. Registration open check
    const now = new Date().toISOString();
    const registrationOpen = m.registration_open_at ? now >= m.registration_open_at : true;
    const registrationClosed = m.registration_close_at ? now >= m.registration_close_at : false;
    const isOpen = m.status === 'OPEN' && registrationOpen && !registrationClosed;

    // 3c. Roster (official + temporary registrations, excluding cancelled)
    const regsResult = await c.env.DB.prepare(`
      SELECT r.id, v.name, v.member_id, r.status, r.seat_number,
             r.waitlist_position, r.created_at, 'OFFICIAL' as source
      FROM registrations r
      JOIN volunteers v ON v.id = r.volunteer_id
      WHERE r.mission_id = ? AND r.status != 'CANCELLED'
      ORDER BY r.registration_sequence ASC
      LIMIT 100
    `).bind(m.id).all();

    const tempResult = await c.env.DB.prepare(`
      SELECT id, name, NULL as member_id, status, seat_number,
             waitlist_position, created_at, 'TEMP' as source
      FROM temporary_registrations
      WHERE mission_id = ? AND status != 'CANCELLED'
      ORDER BY registration_sequence ASC
      LIMIT 50
    `).bind(m.id).all();

    const allRegs = [
      ...(regsResult.results || []),
      ...(tempResult.results || []),
    ].sort((a: any, b: any) => {
      return (a.created_at || '').localeCompare(b.created_at || '');
    }).slice(0, 100);

    const registrations = allRegs.map((row: any) => ({
      id: row.id,
      name: row.name,
      member_id: row.member_id,
      status: row.status,
      seat_number: row.seat_number,
      waitlist_position: row.waitlist_position,
      created_at: row.created_at,
    }));

    // 3d. My registrations (if ownership token provided)
    let myRegistrations: any[] = [];
    const ownershipToken = getOwnershipToken(c);
    if (ownershipToken) {
      const myRegs = await c.env.DB.prepare(`
        SELECT id, status, seat_number, waitlist_position, created_at, ownership_token
        FROM registrations
        WHERE mission_id = ? AND ownership_token = ?
        ORDER BY created_at DESC
      `).bind(m.id, ownershipToken).all();

      myRegistrations = (myRegs.results || []).map((r: any) => ({
        id: r.id,
        status: r.status,
        seat_number: r.seat_number,
        waitlist_position: r.waitlist_position,
        created_at: r.created_at,
      }));
    }

    return success(c, {
      changed: true,
      version: currentVersion,
      mission: {
        id: m.id,
        public_code: m.public_code,
        title: m.title,
        description: m.description,
        location: m.location,
        start_at: m.start_at,
        end_at: m.end_at,
        capacity: m.capacity,
        confirmation_phrase: m.confirmation_phrase,
        status: m.status,
        confirmed: confirmedCount,
        waitlist: waitlistCount,
        available: Math.max(0, m.capacity - confirmedCount),
        is_full: confirmedCount >= m.capacity,
        is_completely_full: confirmedCount >= m.capacity && (waitlistCount >= (m.waiting_list || 0) || !m.waiting_list),
        registration_open: isOpen,
      },
      registrations,
      my_registrations: myRegistrations,
    });
  } catch (err: any) {
    console.error('Live endpoint error:', err);
    return Errors.internal(c);
  }
});
