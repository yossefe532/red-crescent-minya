import { generateUUID } from '../utils/id';
import { hashPassword, verifyPassword } from '../utils/crypto';

export interface AdminUser {
  id: string;
  username: string;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminUserCreateData {
  username: string;
  password: string;
  display_name?: string;
}

export async function createAdminUser(db: D1Database, data: AdminUserCreateData): Promise<AdminUser> {
  const id = generateUUID();
  const passwordHash = await hashPassword(data.password);
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO admin_users (id, username, password_hash, display_name, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `).bind(id, data.username, passwordHash, data.display_name || null, now, now).run();

  return {
    id,
    username: data.username,
    display_name: data.display_name || null,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
}

export async function authenticateAdmin(db: D1Database, username: string, password: string): Promise<AdminUser | null> {
  const user = await db.prepare('SELECT * FROM admin_users WHERE username = ? AND is_active = 1').bind(username).first();
  
  if (!user) {
    return null;
  }

  const isValidPassword = await verifyPassword(password, (user as any).password_hash);
  if (!isValidPassword) {
    return null;
  }

  return {
    id: (user as any).id,
    username: (user as any).username,
    display_name: (user as any).display_name,
    is_active: (user as any).is_active,
    created_at: (user as any).created_at,
    updated_at: (user as any).updated_at,
  };
}