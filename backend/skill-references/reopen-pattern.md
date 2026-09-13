# REOPEN Mission — Handler Pattern

## Overview
Added 2026-09-13. CLOSED missions can be reopened via `m:reopen` callback.

## Files
- `backend/src/telegram/commands/reopen.ts` — `handleReopenMission`
- `backend/src/telegram/commands/close.ts` — `handleCloseMission`
- `backend/src/telegram/keyboards.ts` — `missionDetailKeyboard(missionId, status)`

## Handler Structure

### handleReopenMission
```typescript
export async function handleReopenMission(
  token: string, chatId: number, db: D1Database,
  missionId: string, adminChatId: number
): Promise<void> {
  const mission = await getMissionById(db, missionId);
  if (!mission) { await tgSend(token, chatId, '❌ المهمة غير موجودة.'); return; }
  if (mission.status !== 'CLOSED') {
    await tgSend(token, chatId, `ℹ️ المهمة حالتها: ${mission.status} — لا يمكن إعادة الفتح إلا للمهام المغلقة.`);
    return;
  }
  const nowIso = new Date().toISOString();
  await updateMission(db, missionId, {
    status: 'OPEN',
    registration_open_at: nowIso,
    registration_close_at: null,  // MUST BE NULL
  });
  await logAudit(db, { actorId: String(adminChatId), actorType: 'admin', action: 'MISSION_REOPENED', entityType: 'mission', entityId: missionId });
  await tgSend(token, chatId, `🔓 <b>تم إعادة فتح المهمة!</b>...`, { reply_markup: missionDetailKeyboard(missionId, 'OPEN') });
}
```

### handleCloseMission
```typescript
export async function handleCloseMission(
  token: string, chatId: number, db: D1Database,
  missionId: string, adminChatId: number
): Promise<void> {
  const mission = await getMissionById(db, missionId);
  if (!mission) { await tgSend(token, chatId, '❌ المهمة غير موجودة.'); return; }
  if (mission.status === 'CLOSED') { await tgSend(token, chatId, 'ℹ️ المهمة مغلقة بالفعل.'); return; }
  const nowIso = new Date().toISOString();
  await updateMission(db, missionId, {
    status: 'CLOSED',
    registration_close_at: nowIso,
  });
  await logAudit(db, { actorId: String(adminChatId), actorType: 'admin', action: 'REGISTRATION_CLOSED', entityType: 'mission', entityId: missionId });
  await tgSend(token, chatId, `🔒 <b>تم إغلاق التسجيل!</b>...`, { reply_markup: missionDetailKeyboard(missionId, 'CLOSED') });
}
```

## Critical Rules

1. **registration_close_at MUST be null on reopen** — never set to `end_at` or any past date
2. **Both handlers check mission.status before acting** — prevent invalid transitions
3. **Both log audit** — every state change is recorded
4. **Both use missionDetailKeyboard(missionId, status)** — button visibility depends on status
5. **status must match registration_close_at** — if status='OPEN' but registration_close_at is non-null, web UI and Telegram show contradictory states

## Keyboard Button Mapping

| Mission status | Button shown | Callback data |
|----------------|-------------|---------------|
| OPEN | `🔒 إغلاق التسجيل` | `close_mission` (intent) |
| CLOSED | `🔓 فتح التسجيل` | `m:reopen` |
| DRAFT | `🔓 فتح التسجيل` | `m:reopen` |

## Verification

```sql
SELECT public_code, status, registration_open_at, registration_close_at
FROM missions WHERE public_code = 'MNY-XXX';
```
- Reopen: `status='OPEN'`, `registration_close_at=NULL`
- Close: `status='CLOSED'`, `registration_close_at=<timestamp>`

## Related
- See `references/registration-window-patterns.md` for full lifecycle
- See `hermes-agent-windows` skill for all bot patterns
