import { generateUUID, generateMissionCode } from '../utils/id';
import { logAudit } from './audit.service';

export interface Mission {
  id: string;
  public_code: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  capacity: number;
  status: 'DRAFT' | 'OPEN' | 'CLOSED' | 'CANCELLED' | 'COMPLETED';
  confirmation_phrase: string;
  registration_open_at: string;
  registration_close_at: string;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export interface MissionCreateData {
  title: string;
  description?: string;
  location?: string;
  start_at: string;
  end_at: string;
  capacity: number;
}

export interface MissionListOptions {
  status?: string;
  limit: number;
  offset: number;
}

export async function createMission(db: D1Database, data: Record<string, unknown>): Promise<Mission> {
  console.log('Creating mission with data:', data);
  
  const id = generateUUID();
  const publicCode = generateMissionCode();
  const now = new Date().toISOString();
  const confirmationPhrase = `أؤكد مشاركتي في مهمة ${publicCode}`;
  
  // Registration window defaults to open immediately and close at end of mission
  const registrationOpenAt = (data as any).registration_open_at ?? now;
  const registrationCloseAt = (data as any).registration_close_at ?? data.end_at;

  try {
    const result = await db.prepare(`
      INSERT INTO missions (
        id, public_code, title, description, location, start_at, end_at, capacity,
        status, confirmation_phrase, registration_open_at, registration_close_at,
        created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      publicCode,
      data.title,
      data.description ?? null,
      data.location ?? null,
      data.start_at,
      data.end_at,
      data.capacity,
      'OPEN',
      confirmationPhrase,
      registrationOpenAt,
      registrationCloseAt,
      now,
      now,
      'system'
    ).run();

    console.log('Mission inserted:', result);

    // Get the created mission
    const mission = await getMissionById(db, id);
    if (!mission) {
      throw new Error('Failed to retrieve created mission');
    }

    console.log('Mission created successfully:', mission);
    return mission;
  } catch (error) {
    console.error('Error creating mission:', error);
    throw error;
  }
}

export async function getMissionById(db: D1Database, id: string): Promise<Mission | null> {
  const result = await db.prepare('SELECT * FROM missions WHERE id = ?').bind(id).first();
  return result as Mission | null;
}

export async function getMissionByPublicCode(db: D1Database, publicCode: string): Promise<Mission | null> {
  const result = await db.prepare('SELECT * FROM missions WHERE public_code = ?').bind(publicCode).first();
  return result as Mission | null;
}

export async function listMissions(db: D1Database, options: MissionListOptions): Promise<{ missions: Mission[]; total: number }> {
  let query = 'SELECT * FROM missions';
  const params: any[] = [];

  if (options.status) {
    query += ' WHERE status = ?';
    params.push(options.status);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(options.limit, options.offset);

  const result = await db.prepare(query).bind(...params).all();
  const missions = result.results as unknown as Mission[];

  // Get total count
  let countQuery = 'SELECT COUNT(*) as total FROM missions';
  let countParams: any[] = [];
  
  if (options.status) {
    countQuery += ' WHERE status = ?';
    countParams.push(options.status);
  }

  const countResult = await db.prepare(countQuery).bind(...countParams).first();
  const total = (countResult as any).total || 0;

  return { missions, total };
}

export async function updateMission(db: D1Database, id: string, data: Record<string, unknown>): Promise<Mission | null> {
  const fields = Object.keys(data).filter(key => 
    key !== 'id' && key !== 'created_at' && key !== 'created_by'
  );
  
  if (fields.length === 0) {
    return getMissionById(db, id);
  }

  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const values = fields.map(field => data[field]);
  
  const now = new Date().toISOString();
  
  // Build the full UPDATE statement with updated_at
  const updateQuery = `UPDATE missions SET ${setClause}, updated_at = ? WHERE id = ?`;
  const allValues = [...values, now, id];

  try {
    await db.prepare(updateQuery).bind(...allValues).run();
    
    // IMPORTANT: Re-fetch to get the updated mission with all changes
    const updated = await getMissionById(db, id);
    return updated;
  } catch (error) {
    console.error('Error updating mission:', error);
    throw error;
  }
}

export async function deleteMission(db: D1Database, id: string): Promise<boolean> {
  try {
    const result = await db.prepare('DELETE FROM missions WHERE id = ?').bind(id).run();
    return ((result.meta as any)?.changes || 0) > 0 || (result as any)?.success === true;
  } catch (error) {
    console.error('Error deleting mission:', error);
    throw error;
  }
}

export async function getMissionAvailability(db: D1Database, missionId: string) {
  const result = await db.prepare(`
    SELECT 
      COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed,
      COUNT(CASE WHEN status = 'WAITLIST' THEN 1 END) as waitlist,
      (SELECT capacity FROM missions WHERE id = ?) as capacity
  `).bind(missionId).first();

  return {
    confirmed: (result as any)?.confirmed || 0,
    waitlist: (result as any)?.waitlist || 0,
    capacity: (result as any)?.capacity || 0,
    available: ((result as any)?.capacity || 0) - ((result as any)?.confirmed || 0),
  };
}