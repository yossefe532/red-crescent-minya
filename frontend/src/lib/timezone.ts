/**
 * Frontend Timezone Utility
 *
 * Canonical source of truth: backend stores timestamps in UTC.
 * All user-facing display MUST be formatted for Africa/Cairo (Egypt local time).
 *
 * DO NOT rely on browser locale/timezone. DO NOT hardcode +2/+3 offsets.
 * Use the IANA zone with Intl.DateTimeFormat.
 */

const CAIRO = 'Africa/Cairo';

/**
 * Parse a server timestamp into a Date.
 *
 * Backend stores UTC. Two historical shapes exist:
 *   - New: "2026-09-15T12:30:45.123Z"  (ISO 8601, explicit UTC — Date parses correctly)
 *   - Legacy: "2026-09-10 15:18:42"    (SQL datetime('now'), UTC but NO zone suffix —
 *     `new Date()` would wrongly treat it as LOCAL. We append 'Z' to force UTC.)
 *
 * Returns null for null/undefined/empty values.
 */
export function parseServerTimestamp(value: string | null | undefined): Date | null {
  if (!value || typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;

  // If it lacks an explicit timezone designator, assume UTC (legacy SQL format).
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(s);
  const normalized = hasZone ? s : `${s.replace(' ', 'T')}Z`;

  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

/** True when the source string carried sub-second (millisecond) precision. */
function hasMilliseconds(value: string | null | undefined): boolean {
  if (!value) return false;
  return /\d{2}\.\d{3}/.test(value);
}

/**
 * Format a server timestamp as Egypt local time: HH:mm:ss.SSS
 * Examples: "15:02:13.284"
 *
 * Millisecond precision is shown ONLY when the source actually carries it
 * (we never fabricate ms that the DB did not store).
 */
export function formatEgyptTime(value: string | null | undefined): string {
  const date = parseServerTimestamp(value);
  if (!date) return '';

  const withMs = hasMilliseconds(value);
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: CAIRO,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  };
  let t = new Intl.DateTimeFormat('en-GB', opts).format(date);
  // en-GB can render 24:xx for midnight edge; normalize to 00:xx
  t = t.replace(/^24:/, '00:');
  if (withMs) {
    const ms = date.getMilliseconds().toString().padStart(3, '0');
    t = `${t}.${ms}`;
  }
  return t;
}

/**
 * Precise Egypt-local time: ALWAYS HH:mm:ss.SSS (milliseconds included).
 * Unlike formatEgyptTime, the .SSS part is shown unconditionally — for
 * legacy records stored with second precision the ms part is genuinely .000
 * (the stored Date has 0 ms), it is never fabricated.
 * Used in roster rows where the operator wants the exact registration instant.
 */
export function formatEgyptTimePrecise(value: string | null | undefined): string {
  const date = parseServerTimestamp(value);
  if (!date) return '';

  const opts: Intl.DateTimeFormatOptions = {
    timeZone: CAIRO,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  };
  let t = new Intl.DateTimeFormat('en-GB', opts).format(date);
  t = t.replace(/^24:/, '00:');
  const ms = date.getMilliseconds().toString().padStart(3, '0');
  return `${t}.${ms}`;
}

/**
 * Full Egypt-local date+time for contexts that need a full timestamp:
 * "2026-09-15 15:02" (good for list meta lines).
 */
export function formatEgyptDateTime(value: string | null | undefined): string {
  const date = parseServerTimestamp(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/**
 * "الآن" flag: true when the timestamp is within the last N ms (live arrivals).
 */
export function isRecent(value: string | null | undefined, withinMs = 90000): boolean {
  const date = parseServerTimestamp(value);
  if (!date) return false;
  return Date.now() - date.getTime() <= withinMs;
}