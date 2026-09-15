/**
 * Centralized Timezone Configuration
 * 
 * All user-facing timestamps MUST be displayed in Africa/Cairo.
 * Database stores timestamps canonically in UTC (ISO 8601).
 * Conversion to Egypt local time happens ONLY at display formatting.
 */

/** IANA timezone for Egypt — used by Intl.DateTimeFormat everywhere */
export const APP_TIMEZONE = 'Africa/Cairo' as const;

/**
 * SQL helper: returns current UTC time in ISO 8601 format with milliseconds.
 * Use in SQL strings: ${SQL_NOW_ISO}
 * 
 * Example output: "2026-09-15T12:30:45.123456Z"
 * 
 * Backward-compatible: old records with format "2026-09-10 15:18:42"
 * are still valid and will be parsed correctly by the frontend (with Z-suffix logic).
 */
export const SQL_NOW_ISO = "strftime('%Y-%m-%dT%H:%M:%f', 'now') || 'Z'";
