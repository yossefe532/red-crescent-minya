import { generateUUID } from '../utils/id';

export async function logAudit(
  db: D1Database,
  options: {
    actorId?: string;
    actorType?: 'admin' | 'system' | 'volunteer';
    action: string;
    entityType: string;
    entityId: string;
    metadata?: unknown;
  }
) {
  const id = generateUUID();
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO audit_logs (id, actor_id, actor_type, action, entity_type, entity_id, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    options.actorId || null,
    options.actorType || 'system',
    options.action,
    options.entityType,
    options.entityId,
    JSON.stringify(options.metadata || {}),
    now
  ).run();
}