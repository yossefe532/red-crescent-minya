import { tgSend } from './bot';

/**
 * Check if chatId is an authorized admin.
 * Uses env.ADMIN_CHAT_IDS (passed through call chain), NOT globalThis.
 * @param adminChatIds - Comma-separated admin chat IDs from env
 */
export function isAdmin(chatId: number, adminChatIds: string): boolean {
  if (!adminChatIds || adminChatIds.trim() === '') return true; // First-contact mode — allows anyone
  const ids = adminChatIds
    .split(',')
    .map((s: string) => parseInt(s.trim(), 10))
    .filter((n: number) => !isNaN(n));
  return ids.includes(chatId);
}

export async function requireAdmin(
  token: string,
  chatId: number,
  db: any,
  adminChatIds: string
): Promise<boolean> {
  if (isAdmin(chatId, adminChatIds)) {
    return true;
  }
  await tgSend(
    token,
    chatId,
    '⛔ <b>غير مصرح لك بالوصول إلى لوحة الإدارة.</b>\n\n' +
    'هذا البوت مخصص لمشرفي الهلال الأحمر المصري — فرع المنيا.\n' +
    'للتسجيل في المهام التطوعية المتاحة، يرجى زيارة الرابط التالي:\n' +
    '🌐 https://red-crescent-minya.pages.dev'
  );
  return false;
}
