/**
 * Telegram Webhook — Thin Router
 * All logic lives in ../telegram/* modules. This file routes webhook updates.
 */
import { Hono } from 'hono';
import { tgSend, tgAnswerCb } from '../telegram/bot';
import { requireAdmin, isAdmin } from '../telegram/auth';
import { mainMenuKeyboard, publicUserKeyboard } from '../telegram/keyboards';
import { parseIntent } from '../telegram/intent';
import { handleCallbackQuery } from '../telegram/callbacks';
import { handleWizardMessage } from '../telegram/wizard';
import {
  startCommandHandler,
  helpCommandHandler,
  cancelCommandHandler,
} from '../telegram/commands/start';
import {
  handleListMissions,
  handleStats,
  handleHealth,
  handleMissionDetail,
  handleGetLink,
  handleWhatsAppMessage,
  handleExportCSV,
  handleMissionSelectForRegistrants,
} from '../telegram/commands/missions';
import { startCreateWizard } from '../telegram/commands/create';
import { startDeleteWizard } from '../telegram/commands/delete';
import { handleCloseMission } from '../telegram/commands/close';
import { handleReopenMission } from '../telegram/commands/reopen';
import {
  handleRegistrants,
  handleWaitlist,
  handleVolunteerDetail,
} from '../telegram/commands/registrants';
import { startCancelWizard } from '../telegram/commands/cancel-reg';
import { getMissionByPublicCode } from '../services/mission.service';
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
  const adminChatIds = ADMIN_CHAT_IDS || '';

  try {
    const update = await c.req.json();
    const msg = update.message || update.callback_query?.message;
    const chatId = msg?.chat?.id;

    if (!chatId) return c.json({ ok: true });
    if (!token) {
      console.error('[TG] TELEGRAM_BOT_TOKEN not set');
      return c.json({ ok: true });
    }

    // ── Callback queries ───────────────────────────────────────
    if (update.callback_query) {
      const cb = update.callback_query;
      await handleCallbackQuery(token, chatId, DB, cb, adminChatIds);
      return c.json({ ok: true });
    }

    // ── Text messages ──────────────────────────────────────────
    if (update.message?.text) {
      const text = update.message.text.trim();

      // Commands first (handling @botname suffixes as well)
      if (text.startsWith('/')) {
        const rawCmd = text.split(' ')[0].toLowerCase();
        const cmd = rawCmd.split('@')[0];

        if (cmd === '/start') {
          await startCommandHandler(token, chatId, DB, adminChatIds);
          return c.json({ ok: true });
        }
        if (cmd === '/help') {
          await helpCommandHandler(token, chatId, DB, adminChatIds);
          return c.json({ ok: true });
        }
        if (cmd === '/cancel') {
          await cancelCommandHandler(token, chatId, DB, adminChatIds);
          return c.json({ ok: true });
        }

        // Admin-only commands
        if (cmd === '/missions') {
          if (!await requireAdmin(token, chatId, DB, adminChatIds)) return c.json({ ok: true });
          await handleListMissions(token, chatId, DB, 1, 'ALL');
          return c.json({ ok: true });
        }
        if (cmd === '/create') {
          if (!await requireAdmin(token, chatId, DB, adminChatIds)) return c.json({ ok: true });
          await startCreateWizard(token, chatId, DB);
          return c.json({ ok: true });
        }
        if (cmd === '/registrants' || cmd === '/volunteers') {
          if (!await requireAdmin(token, chatId, DB, adminChatIds)) return c.json({ ok: true });
          await handleMissionSelectForRegistrants(token, chatId, DB);
          return c.json({ ok: true });
        }
        if (cmd === '/stats') {
          if (!await requireAdmin(token, chatId, DB, adminChatIds)) return c.json({ ok: true });
          await handleStats(token, chatId, DB);
          return c.json({ ok: true });
        }
        if (cmd === '/health') {
          if (!await requireAdmin(token, chatId, DB, adminChatIds)) return c.json({ ok: true });
          await handleHealth(token, chatId, DB);
          return c.json({ ok: true });
        }
      }

      // If user is not admin and sends regular text, give public guidance
      if (!isAdmin(chatId, adminChatIds)) {
        await startCommandHandler(token, chatId, DB, adminChatIds);
        return c.json({ ok: true });
      }

      // Wizard state takes priority over intent parsing
      const wizardHandled = await handleWizardMessage(token, chatId, DB, text);
      if (wizardHandled) return c.json({ ok: true });

      // Intent-based fallback routing for admins
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
          await handleListMissions(token, chatId, DB, 1, 'ALL');
          break;
        case 'list_active':
          await handleListMissions(token, chatId, DB, 1, 'OPEN');
          break;
        case 'stats':
          await handleStats(token, chatId, DB);
          break;
        case 'get_link': {
          const code = intent.extracted.missionCode;
          if (code) {
            await handleGetLink(token, chatId, DB, code);
          } else {
            await handleListMissions(token, chatId, DB, 1, 'ALL');
          }
          break;
        }
        case 'export_csv':
          if (intent.extracted.missionCode) {
            await handleExportCSV(token, chatId, DB, intent.extracted.missionCode);
          } else {
            await handleListMissions(token, chatId, DB, 1, 'ALL');
          }
          break;
        case 'help':
          await helpCommandHandler(token, chatId, DB, adminChatIds);
          break;
        case 'view_registrants':
          if (intent.extracted.missionCode) {
            await handleRegistrants(token, chatId, DB, intent.extracted.missionCode);
          } else {
            await handleMissionSelectForRegistrants(token, chatId, DB);
          }
          break;
        case 'view_waitlist':
          if (intent.extracted.missionCode) {
            await handleWaitlist(token, chatId, DB, intent.extracted.missionCode);
          } else {
            await handleMissionSelectForRegistrants(token, chatId, DB);
          }
          break;
        case 'cancel_registration':
          await startCancelWizard(
            token,
            chatId,
            DB,
            intent.extracted.missionCode || intent.extracted.missionHint
          );
          break;
        case 'delete_mission':
          await startDeleteWizard(
            token,
            chatId,
            DB,
            intent.extracted.missionCode || intent.extracted.missionHint
          );
          break;
        case 'close_mission': {
          const code = intent.extracted.missionCode || intent.extracted.missionHint;
          if (code) {
            const mission = await getMissionByPublicCode(DB, code);
            if (mission) await handleCloseMission(token, chatId, DB, mission.id, chatId);
          } else {
            await handleListMissions(token, chatId, DB, 1, 'OPEN');
          }
          break;
        }
        case 'open_mission': {
          const code = intent.extracted.missionCode || intent.extracted.missionHint;
          if (code) {
            const mission = await getMissionByPublicCode(DB, code);
            if (mission) await handleReopenMission(token, chatId, DB, mission.id, chatId);
          } else {
            await handleListMissions(token, chatId, DB, 1, 'CLOSED');
          }
          break;
        }
        default:
          await tgSend(token, chatId, '❓ لم أفهم الأمر. يرجى الاختيار من القائمة أدناه:', {
            reply_markup: mainMenuKeyboard(),
          });
      }
    }

    return c.json({ ok: true });
  } catch (err) {
    console.error('[TG] Webhook error:', err);
    return c.json({ ok: true }); // Always return 200 to Telegram
  }
});
