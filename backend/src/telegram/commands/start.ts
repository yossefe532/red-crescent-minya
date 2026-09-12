/**
 * Telegram Bot — Start Command Handler
 * /start, /help, /cancel
 */
import { clearSession, tgSend } from '../bot';
import { helpText } from '../formatters';
import { mainMenuKeyboard } from '../keyboards';

export async function startCommandHandler(token: string, chatId: number, db: D1Database): Promise<void> {
  await clearSession(db, chatId);
  await tgSend(token, chatId,
    helpText(),
    { reply_markup: mainMenuKeyboard() }
  );
}

export async function helpCommandHandler(token: string, chatId: number, db: D1Database): Promise<void> {
  await tgSend(token, chatId,
    helpText(),
    { reply_markup: mainMenuKeyboard() }
  );
}

export async function cancelCommandHandler(token: string, chatId: number, db: D1Database): Promise<void> {
  await clearSession(db, chatId);
  await tgSend(token, chatId,
    '🏠 <b>تم الإلغاء.</b>',
    { reply_markup: mainMenuKeyboard() }
  );
}