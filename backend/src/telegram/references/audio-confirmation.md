# Audio Confirmation Recording — Base64 Pattern

## Context
When volunteers confirm their registration via voice message, the Telegram bot records the audio and stores it in Cloudflare D1.

## D1 BLOB Limitation
**D1 does NOT support raw BLOB bindings** — they get converted to CSV text instead. This means audio data must be stored as **base64-encoded text**.

## Conversion Pattern
```typescript
// Convert AudioBuffer to base64 string for D1 storage
let binary = '';
const chunk = 0x8000;
for (let i = 0; i < audioBuffer.length; i += chunk) {
  binary += String.fromCharCode.apply(null, Array.from(audioBuffer.subarray(i, i + chunk)));
}
const audioB64 = btoa(binary);
```

To decode later:
```typescript
const binary = atob(audioB64);
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) {
  bytes[i] = binary.charCodeAt(i);
}
const audioBuffer = new Uint8Array(bytes.buffer);
```

## Phrase Default Chain
When recording the confirmation, the phrase used in the `audio_confirmations` record defaults via this chain:
1. `phrase` parameter (if provided by user/volunteer)
2. `missionData.confirmation_phrase` (mission-specific custom phrase)
3. Auto-generated: `أؤكد مشاركتي في مهمة ${missionData.public_code}`

```typescript
const usedPhrase = phrase || missionData.confirmation_phrase || `أؤكد مشاركتي في مهمة ${missionData.public_code}`;
```

## Audio Duration Estimation
If `duration_ms` is not provided by the client, estimate from buffer size:
```typescript
const estDurationMs = durationMs || Math.max(2000, Math.floor(audioBuffer.byteLength / 8));
```

## Table Schema (D1)
```sql
CREATE TABLE audio_confirmations (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL,
  phrase TEXT NOT NULL,
  audio_key TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  audio_data TEXT NOT NULL,  -- base64 encoded (D1 does not support BLOB)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Insert Pattern
```typescript
await c.env.DB.prepare(
  `INSERT INTO audio_confirmations (
    id, registration_id, phrase, audio_key, duration_ms, mime_type, audio_data, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
).bind(audioId, registrationId, usedPhrase, audioKey, estDurationMs, mimeType, audioB64).run();
```

## Source File
- Implementation: `backend/src/routes/registration.ts` — around line 544-562
- Function: audio confirmation save step (step 10 of the registration flow)

---
*Pattern discovered during Red Crescent Minya audio confirmation feature implementation (2026-09-13). Source: `registration.ts`.*
