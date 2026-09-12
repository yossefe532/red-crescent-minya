/**
 * Telegram Bot — Core Utilities
 * Telegram API helpers, authorization, D1 session management.
 */
import { WizardState, WizardData, SessionRow } from './types';

// ─── Telegram API Helpers ──────────────────────────────────────
export async function tgSend(
  token: string,
  chatId: number,
  text: string,
  extra?: Record<string, unknown>
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...extra,
  };
  if (body.reply_markup) {
    body.reply_markup = normalizeReplyMarkup(body.reply_markup);
  }
  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('tgSend failed', res.status, errText);
  }
}

export async function tgEdit(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  extra?: Record<string, unknown>
): Promise<void> {
  await fetch(
    `https://api.telegram.org/bot${token}/editMessageText`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        ...extra,
      }),
    }
  ).catch(console.error);
}

export async function tgAnswerCb(
  token: string,
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await fetch(
    `https://api.telegram.org/bot${token}/answerCallbackQuery`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: !!text,
      }),
    }
  ).catch(console.error);
}

export async function tgSendVoice(
  token: string,
  chatId: number,
  audioBytes: Uint8Array,
  mime: string,
  caption?: string,
  durationSec?: number
): Promise<boolean> {
  try {
    const ext = mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : 'mp3';
    const formData = new FormData();
    formData.append('chat_id', chatId.toString());
    formData.append('voice', new Blob([audioBytes], { type: mime }), `recording.${ext}`);
    if (caption) formData.append('caption', caption);
    if (durationSec && durationSec > 0) formData.append('duration', durationSec.toString());

    const res = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, {
      method: 'POST',
      body: formData,
    });
    return res.ok;
  } catch (e) {
    console.error('tgSendVoice failed:', e);
    return false;
  }
}

export async function tgSendDocument(
  token: string,
  chatId: number,
  fileBytes: Uint8Array | string,
  fileName: string,
  caption?: string,
  mimeType = 'text/csv'
): Promise<boolean> {
  try {
    const formData = new FormData();
    formData.append('chat_id', chatId.toString());
    const blob = typeof fileBytes === 'string'
      ? new Blob([fileBytes], { type: mimeType })
      : new Blob([fileBytes], { type: mimeType });
    formData.append('document', blob, fileName);
    if (caption) formData.append('caption', caption);

    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: formData,
    });
    return res.ok;
  } catch (e) {
    console.error('tgSendDocument failed:', e);
    return false;
  }
}

// ─── Reply Markup Normalization ────────────────────────────────
function normalizeReplyMarkup(markup: unknown): unknown {
  if (!markup || typeof markup !== 'object') return markup;
  const m = markup as any;
  // InlineKeyboard from grammy
  if (typeof m.toJSON === 'function') return m.toJSON();
  // Already a plain object with inline_keyboard array
  if (Array.isArray(m.inline_keyboard)) return { inline_keyboard: m.inline_keyboard };
  // Function-based (grammy internal)
  if (typeof m.inline_keyboard === 'function') return { inline_keyboard: m.inline_keyboard() };
  return markup;
}

// ─── Authorization ─────────────────────────────────────────────
export function isAuthorizedChat(chatId: number, adminChatIds?: string): boolean {
  if (!adminChatIds) return true; // First-contact mode — allows anyone
  const ids = adminChatIds
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
  return ids.includes(chatId);
}

// ─── D1 Session Helpers ────────────────────────────────────────
export async function getSession(
  db: D1Database,
  chatId: number
): Promise<{ state: WizardState; data: WizardData }> {
  const row = await db
    .prepare('SELECT state, data FROM telegram_sessions WHERE chat_id = ?')
    .bind(chatId)
    .first<SessionRow>();
  if (!row) return { state: 'idle', data: {} };
  return {
    state: row.state as WizardState,
    data: JSON.parse(row.data || '{}'),
  };
}

export async function setSession(
  db: D1Database,
  chatId: number,
  state: WizardState,
  data: WizardData
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO telegram_sessions (chat_id, state, data, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(chat_id) DO UPDATE SET state=?, data=?, updated_at=datetime('now')`
    )
    .bind(chatId, state, JSON.stringify(data), state, JSON.stringify(data))
    .run();
}

export async function clearSession(db: D1Database, chatId: number): Promise<void> {
  await setSession(db, chatId, 'idle', {});
}

// ─── HTML Escaping ─────────────────────────────────────────────
export function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
