# NOTIFICATION FLOW
**Date:** 2026-09-13

## Registration Notification Flow
1. Volunteer submits registration (POST /api/register)
2. Backend validates, allocates seat, stores in DB
3. If mission.telegram_notifications=1 AND status in (CONFIRMED, WAITLIST):
   - Fire-and-forget: sendTelegramRegistrationNotification()
   - Sends text + inline keyboard (🎙️ استمع + 👋 رجوع)
   - Attempts to send audio via sendVoice with file_id
4. Capacity notifications (separate):
   - Core capacity full → warning
   - Waitlist full → alert
   - Mission completely full → completion

## Notification Content (Current)
- Name ✅
- Member ID ✅
- Mission title + code ✅
- Status ✅
- Seat number ✅
- Waitlist position ✅
- Audio indicator ✅
- Recording audio ❌ (no file_id in most cases)

## Notification Toggle
- Per-mission: missions.telegram_notifications (0/1)
- Global: settings table key 'notifications_enabled'
- Read by: Telegram nav:notifications handler

## Delivery Method
- Direct Telegram API (fetch to api.telegram.org)
- Synchronous per-chat (sequential for multi-admin)
- No queue, no retry, no webhook
- Failures logged to console only
