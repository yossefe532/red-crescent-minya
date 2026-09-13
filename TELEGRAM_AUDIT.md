# TELEGRAM BOT AUDIT
**Date:** 2026-09-13 | **Mode:** READ-ONLY

## Bot Framework & Architecture
- Library: Grammy (v2)
- Transport: Webhook (POST /telegram), NOT polling
- Token: in ENV TELEGRAM_BOT_TOKEN
- Admin auth: ADMIN_CHAT_IDS (comma-separated chat IDs)
- Session state: D1 table telegram_sessions (chat_id PK, state, data JSON)

## Commands (6)
| Command | Handler | Purpose |
|---------|---------|---------|
| /start | startCommandHandler | Clears session, sends help + main menu |
| /help | helpCommandHandler | Sends help text + main menu |
| /cancel | cancelCommandHandler | Clears session, returns to main menu |
| /list | (intent list_missions) | Lists missions |
| /stats | (intent stats) | Shows stats |
| /detail | (intent - via button) | Mission detail |

Additionally: text messages are routed via intent parser (Egyptian Arabic NLP).

## Intent Types (16)
create_mission, list_missions, list_active, stats, status, help, open_mission, close_mission, delete_mission, cancel_registration, view_waitlist, view_registrants, edit_mission, export_csv, get_link, unknown

## Callback Prefixes (7)
- nav:* — Navigation (home, missions, create, stats, help, notifications, health)
- m:* — Mission actions (detail, detail_pub, regs, wait, close, open, link, whatsapp, edit, export, delete, delete_pick)
- v:* — Volunteer actions (detail, audio, move:{REGID}:STATUS, cancel)
- wiz:* — Wizard actions (skip:{field}, cancel, confirm:create, restart)
- confirm:* — Confirmations (delete, cancelreg)
- edit:field:* — Edit field selection
- delete:pick:* — Delete picker
- notify:* — Notification toggle (on/off)

## Total unique callbacks: ~40+

## Authorization
- isAuthorizedChat(chatId, ADMIN_CHAT_IDS) — checked on EVERY webhook hit
- No per-callback authorization — once authorized, all callbacks allowed
- Admin IDs stored in ENV ADMIN_CHAT_IDS as comma-separated string

## State Management
- Per-chat D1 sessions (telegram_sessions table)
- States: idle, create_*, delete_confirm, edit_value, cancelreg_*
- Session stored as JSON blob in `data` column

## Known Issues
- close_mission intent → calls startDeleteWizard (wrong handler — BUG)
- open_mission intent → calls startDeleteWizard (wrong handler — BUG)
- handleToggleRegistration: actorId hardcoded 'telegram' (TODO)
- tgEdit and tgAnswerCb have .catch(console.error) but no error propagation
- tgSend: throws on failure; no retry
