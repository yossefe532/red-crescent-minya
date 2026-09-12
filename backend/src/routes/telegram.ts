/**
 * Telegram Webhook — Thin Router
 * All logic lives in ../telegram/* modules. This file just routes.
 */
import { Hono } from 'hono';
import { isAuthorizedChat, tgSend, tgAnswerCb, clearSession } from '../telegram/bot';
import { mainMenuKeyboard } from '../telegram/keyboards';
import { parseIntent } from '../telegram/intent';
import { handleCallbackQuery } from '../telegram/callbacks';
import { handleWizardMessage } from '../telegram/wizard';
import { startCommandHandler, helpCommandHandler, cancelCommandHandler } from '../telegram/commands/start';
import { handleListMissions, handleStats, handleMissionDetail, handleGetLink, handleWhatsAppMessage, handleExportCSV } from '../telegram/commands/missions';
import { startCreateWizard } from '../telegram/commands/create';
import { handleToggleRegistration } from '../telegram/commands/toggle';
import { startDeleteWizard } from '../telegram/commands/delete';
import { handleRegistrants, handleWaitlist, handleVolunteerDetail } from '../telegram/commands/registrants';
import { startCancelWizard } from '../telegram/commands/cancel-reg';
import { Env } from '../env';

// ─── Router ────────────────────────────────────────────────────
export const telegramRoutes = new Hono<{ Bindings: Env }>();

// Health check
telegramRoutes.get('/', (c) => c.json({ ok: true, service: 'telegram-webhook' }));

// ─── Set Webhook (manual) ──────────────────────────────────────
telegramRoutes.post('/setWebhook', async (c) => {
  const token = c.env.TELEGRAM_BOT_TOKEN;
  const url = c.req.query('url');
  if (!token) return c.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, 500);
  if (!url) return c.json({ error: 'url query param required' }, 400);
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, allowed_updates: ['message', 'callback_query'] }),
  });
  return c.json(await res.json());
});

// ─── Main Webhook ──────────────────────────────────────────────
telegramRoutes.post('/', async (c) => {
  const { DB, TELEGRAM_BOT_TOKEN, ADMIN_CHAT_IDS, AI } = c.env;
  const token = TELEGRAM_BOT_TOKEN || '';

  try {
    const update = await c.req.json();
    const msg = update.message || update.callback_query?.message;
    const chatId = msg?.chat?.id;

    if (!chatId) return c.json({ ok: true });
    if (!token) {
      console.error('[TG] TELEGRAM_BOT_TOKEN not set');
      return c.json({ ok: true });
    }

    // Authorization
    if (!isAuthorizedChat(chatId, ADMIN_CHAT_IDS)) {
      await tgSend(token, chatId, '⛔ غير مصرح لك باستخدام هذا البوت.');
      return c.json({ ok: true });
    }

    // ── Callback queries ───────────────────────────────────────
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data as string;
      await tgAnswerCb(token, cb.id);
      await handleCallbackQuery(token, chatId, DB, cb);
      return c.json({ ok: true });
    }

    // ── Text messages ──────────────────────────────────────────
    if (update.message?.text) {
      const text = update.message.text.trim();

      // Commands first
      if (text.startsWith('/')) {
        const cmd = text.split(' ')[0].toLowerCase();
        if (cmd === '/start')  { await startCommandHandler(token, chatId, DB); return c.json({ ok: true }); }
        if (cmd === '/help')   { await helpCommandHandler(token, chatId, DB); return c.json({ ok: true }); }
        if (cmd === '/cancel') { await cancelCommandHandler(token, chatId, DB); return c.json({ ok: true }); }
      }

      // Wizard state takes priority over intent parsing
      const wizardHandled = await handleWizardMessage(token, chatId, DB, text);
      if (wizardHandled) return c.json({ ok: true });

      // Intent-based routing
      const intent = await parseIntent(text, AI);
      switch (intent.intent) {
        case 'create_mission':
          if (intent.extracted.title) {
            await startCreateWizard(token, chatId, DB, {
              title: intent.extracted.title,
              location: intent.extracted.location,
              capacity: intent.extracted.capacity,
            });
          } else {
            await startCreateWizard(token, chatId, DB);
          }
          break;
        case 'list_missions':
          await handleListMissions(token, chatId, DB, c.env, false);
          break;
        case 'list_active':
          await handleListMissions(token, chatId, DB, c.env, true);
          break;
        case 'stats':
          await handleStats(token, chatId, DB);
          break;
        case 'get_link': {
          const code = intent.extracted.missionCode;
          if (code) {
            await handleGetLink(token, chatId, DB, code);
          } else {
            await startDeleteWizard(token, chatId, DB); // start picker
          }
          break;
        }
        case 'export_csv':
          await handleExportCSV(token, chatId, DB, intent.extracted.missionCode || '');
          break;
        case 'help':
          await helpCommandHandler(token, chatId, DB);
          break;
        case 'view_registrants':
          await handleRegistrants(token, chatId, DB, intent.extracted.missionCode || '');
          break;
        case 'view_waitlist':
          await handleWaitlist(token, chatId, DB, intent.extracted.missionCode || '');
          break;
        case 'cancel_registration':
          await startCancelWizard(token, chatId, DB, intent.extracted.missionCode || intent.extracted.missionHint);
          break;
        case 'delete_mission':
          await startDeleteWizard(token, chatId, DB, intent.extracted.missionCode || intent.extracted.missionHint);
          break;
        case 'close_mission': {
          const code = intent.extracted.missionCode || intent.extracted.missionHint;
          if (code) {
            await startDeleteWizard(token, chatId, DB, code); // picker will resolve
          } else {
            await startDeleteWizard(token, chatId, DB);
          }
          break;
        }
        case 'open_mission':
          await startDeleteWizard(token, chatId, DB, intent.extracted.missionCode || intent.extracted.missionHint);
          break;
        default:
          await tgSend(token, chatId, '❓ لم أفهم. اختر من القائمة:', { reply_markup: mainMenuKeyboard() });
      }
    }

    return c.json({ ok: true });
  } catch (err) {
    console.error('[TG] Webhook error:', err);
    return c.json({ ok: true }); // Always 200 to Telegram
  }
});