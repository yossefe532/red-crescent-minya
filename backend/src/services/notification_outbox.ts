export interface NotificationEvent {
  id: string;
  eventType: string;
  registrationId: string;
  missionId: string;
  adminChatId: string;
  payload: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
  processedAt?: string;
  lastError?: string;
}

export async function createNotificationEvent(
  db: any,
  data: Omit<NotificationEvent, 'id' | 'status' | 'attempts' | 'nextAttemptAt' | 'createdAt'>
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const nextAttempt = new Date(Date.now() + 1000).toISOString();

  await db.prepare(
    `INSERT INTO notification_events (id, event_type, registration_id, mission_id, admin_chat_id, payload, status, attempts, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)`
  ).bind(id, data.eventType, data.registrationId, data.missionId, data.adminChatId, data.payload, nextAttempt, now).run();

  return id;
}

export async function markProcessed(
  db: any,
  id: string
): Promise<void> {
  await db.prepare(
    `UPDATE notification_events SET status = 'SENT', processed_at = ?, attempts = attempts + 1 WHERE id = ?`
  ).bind(new Date().toISOString(), id).run();
}

export async function markFailed(
  db: any,
  id: string,
  error: string,
  attempts: number,
  maxAttempts: number,
  nextAttempt?: string
): Promise<void> {
  if (attempts >= maxAttempts) {
    await db.prepare(
      `UPDATE notification_events SET status = 'FAILED', attempts = ?, last_error = ?, processed_at = ? WHERE id = ?`
    ).bind(attempts, error, new Date().toISOString(), id).run();
  } else {
    await db.prepare(
      `UPDATE notification_events SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?`
    ).bind(attempts, nextAttempt || new Date().toISOString(), error, id).run();
  }
}

export async function getPendingEvents(
  db: any,
  limit = 50
): Promise<NotificationEvent[]> {
  const now = new Date().toISOString();
  const result = await db.prepare(
    `SELECT * FROM notification_events WHERE status = 'PENDING' AND next_attempt_at <= ? ORDER BY created_at ASC LIMIT ?`
  ).bind(now, limit).all();
  return (result.results || []) as NotificationEvent[];
}

/**
 * Send a Telegram message via the Bot API (no parse_mode shortcuts).
 */
async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  replyMarkup?: string
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Telegram sendMessage failed (${res.status}): ${errText.slice(0, 300)}`);
  }
}

/**
 * Process due notification events from the outbox.
 * For each event, sends the real Telegram message, then marks SENT or
 * schedules a retry with exponential backoff (maxAttempts = 5).
 */
export async function processPendingNotifications(
  db: any,
  token: string,
  adminChatIds: string
): Promise<{ sent: number; failed: number; retried: number }> {
  // Check global notification setting — skip processing when disabled
  try {
    const setting = await db.prepare(
      "SELECT value FROM settings WHERE key = 'notifications_enabled'"
    ).first();
    if (setting && setting.value !== '1' && setting.value !== 'true') {
      return { sent: 0, failed: 0, retried: 0 };
    }
  } catch {
    // If settings table doesn't exist or query fails, default to enabled
  }

  const events = await getPendingEvents(db, 50);
  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const event of events) {
    try {
      const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
      const chatId = payload.chat_id || event.adminChatId;

      if (!token || !chatId) {
        throw new Error('Missing token or chatId');
      }

      // Build the real message text from the payload
      const text = payload.text || (payload.message ? String(payload.message) : '');
      if (!text) {
        throw new Error('Outbox event has no message text');
      }

      const replyMarkup = payload.keyboard
        ? JSON.stringify({ inline_keyboard: payload.keyboard })
        : undefined;

      await sendTelegramMessage(token, String(chatId), text, replyMarkup);
      await markProcessed(db, event.id);
      sent++;
    } catch (error) {
      const attempts = event.attempts + 1;
      const maxAttempts = 5;

      if (attempts >= maxAttempts) {
        await markFailed(db, event.id, String(error), attempts, maxAttempts);
        failed++;
      } else {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        const backoffMs = Math.pow(2, attempts - 1) * 1000;
        const nextAttempt = new Date(Date.now() + backoffMs).toISOString();
        await markFailed(db, event.id, String(error), attempts, maxAttempts, nextAttempt);
        retried++;
      }
    }
  }

  return { sent, failed, retried };
}