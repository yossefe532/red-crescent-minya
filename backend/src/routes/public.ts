import { Hono } from 'hono';
import { Env } from '../env';
import { success, Errors } from '../utils/response';

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
             registration_open_at, registration_close_at
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
    
    const mission = await c.env.DB.prepare(`
      SELECT id FROM missions WHERE public_code = ?
    `).bind(publicCode).first();
    
    if (!mission) {
      return Errors.notFound(c, 'Mission');
    }
    
    const missionData = mission as any;
    
    const result = await c.env.DB.prepare(`
      SELECT r.id, v.name, v.member_id, r.status, r.seat_number, 
             r.waitlist_position, r.created_at
      FROM registrations r
      JOIN volunteers v ON v.id = r.volunteer_id
      WHERE r.mission_id = ?
      ORDER BY r.registration_sequence ASC
      LIMIT 50
    `).bind(missionData.id).all();
    
    const registrations = (result.results || []).map((row: any) => ({
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
