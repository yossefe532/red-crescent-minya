/**
 * Telegram Bot — Egyptian Arabic Date/Time Resolver
 * Resolves relative & absolute Arabic date expressions to ISO strings.
 * All dates assume timezone Africa/Cairo (UTC+2 / UTC+3 DST).
 */

// Cairo timezone offset: EET = +2, EEST = +3
function cairoOffsetMs(): number {
  // Use Intl to get the actual offset for Africa/Cairo at a given time
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false,
  });
  const cairoParts = fmt.formatToParts(now);
  const utcParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const toSec = (parts: Intl.DateTimeFormatPart[]) => {
    let h = 0, m = 0, s = 0;
    for (const p of parts) {
      if (p.type === 'hour') h = parseInt(p.value);
      if (p.type === 'minute') m = parseInt(p.value);
      if (p.type === 'second') s = parseInt(p.value);
    }
    return h * 3600 + m * 60 + s;
  };

  return (toSec(cairoParts) - toSec(utcParts)) * 1000;
}

/** Get current date/time in Cairo timezone */
export function nowInCairo(): Date {
  const now = new Date();
  const offset = cairoOffsetMs();
  return new Date(now.getTime() + offset);
}

/** Get Cairo "today" as a Date object (midnight Cairo time) */
function cairoToday(): Date {
  const c = nowInCairo();
  return new Date(c.getFullYear(), c.getMonth(), c.getDate());
}

// ─── Arabic Day Name Mapping ──────────────────────────────────
const ARABIC_DAYS: Record<string, number> = {
  'الاتنين': 1, 'الاثنين': 1, 'اتنين': 1, 'التنين': 1,
  'الثلاث': 2, 'ثلاث': 2, 'ثلاثا': 2, 'الثلاثا': 2,
  'الاربع': 3, 'اربع': 3, 'الاربعاء': 3,
  'الخميس': 4, 'خميس': 4,
  'الجمعه': 5, 'الجمعة': 5, 'جمعه': 5,
  'السبت': 6, 'سبت': 6,
  'الحد': 0, 'الأحد': 0, 'احد': 0, 'حد': 0, ' sunday': 0,
};

// ─── Arabic Time-of-Day Keywords ──────────────────────────────
const TIME_OF_DAY: Record<string, { hour: number; minute: number }> = {
  'صباحاً': { hour: 8, minute: 0 },
  'صباح': { hour: 8, minute: 0 },
  'باصبح': { hour: 8, minute: 0 },
  'بكرة الصبح': { hour: 8, minute: 0 },
  'الفجر': { hour: 5, minute: 0 },
  'الظهر': { hour: 12, minute: 0 },
  'بعد الظهر': { hour: 14, minute: 0 },
  'بعدالظهر': { hour: 14, minute: 0 },
  'العصر': { hour: 15, minute: 0 },
  'المغرب': { hour: 18, minute: 0 },
  'بعدالمغرب': { hour: 19, minute: 0 },
  'بعد المغرب': { hour: 19, minute: 0 },
  'المغربối': { hour: 18, minute: 0 },
  'العشا': { hour: 20, minute: 0 },
  'العشاء': { hour: 20, minute: 0 },
  'بالليل': { hour: 21, minute: 0 },
  'مساءً': { hour: 19, minute: 0 },
  'مساء': { hour: 19, minute: 0 },
  'بالليله': { hour: 21, minute: 0 },
  'نص الليل': { hour: 0, minute: 0 },
};

// ─── Arabic Number Words ──────────────────────────────────────
const ARABIC_NUMS: Record<string, number> = {
  'واحد': 1, 'وحدة': 1, 'احد': 1, 'واحدة': 1,
  'اتنين': 2, 'اثنين': 2, 'اثنا': 2, 'اثني': 2,
  'تلاتة': 3, 'ثلاثة': 3, 'تلت': 3, 'تلات': 3, 'ثلاث': 3,
  'اربعة': 4, 'اربع': 4,
  'خمسة': 5, 'خمس': 5,
  'ستة': 6, 'ست': 6,
  'سبعة': 7, 'سبع': 7,
  'ثمانية': 8, 'ثمان': 8, 'تمان': 8, 'تمانية': 8,
  'تسعة': 9, 'تسع': 9,
  'عشرة': 10, 'عشر': 10,
  'حد': 1, 'حدا': 1, 'حدة': 1,
};

function parseArabicNumber(text: string): number | null {
  const t = text.trim();
  // Arabic word
  if (ARABIC_NUMS[t] !== undefined) return ARABIC_NUMS[t];
  // Arabic-Indic numerals (٠١٢٣٤٥٦٧٨٩)
  const indicMap: Record<string, string> = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  };
  let converted = t;
  for (const [ar, en] of Object.entries(indicMap)) {
    converted = converted.split(ar).join(en);
  }
  const n = parseInt(converted, 10);
  return isNaN(n) ? null : n;
}

// ─── Time Parser ──────────────────────────────────────────────
function parseArabicTime(text: string): { hour: number; minute: number } | null {
  const t = text.trim();

  // Check time-of-day keywords first
  for (const [kw, val] of Object.entries(TIME_OF_DAY)) {
    if (t.includes(kw)) return val;
  }

  // "الساعة 3" / "الساعه 3" / "الساعة 3:30" / "الساعة 3 مساءً" / "الساعة 3 ص"
  const timeMatch = t.match(
    /(?:الساعة|الساعه|على\s*الساعة|على\s*الساعه|الساعه| foulс\s*الساعة)\s*(\d{1,2})(?::(\d{2}))?\s*(صباحاً|مساءً|ص|م|am|pm)?/i
  );
  if (timeMatch) {
    let hour = parseInt(timeMatch[1]);
    const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const period = (timeMatch[3] || '').toLowerCase();
    if ((period === 'مساءً' || period === 'مساء' || period === 'م' || period === 'pm') && hour < 12) {
      hour += 12;
    } else if ((period === 'صباحاً' || period === 'صباح' || period === 'ص' || period === 'am') && hour === 12) {
      hour = 0;
    }
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  // Bare number like "3" or "15"
  const bareMatch = t.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (bareMatch) {
    const hour = parseInt(bareMatch[1]);
    const minute = bareMatch[2] ? parseInt(bareMatch[2]) : 0;
    if (hour >= 0 && hour <= 23) return { hour, minute };
  }

  return null;
}

// ─── Main Date Resolution ─────────────────────────────────────
export interface ResolvedDate {
  date: string;      // "YYYY-MM-DD"
  time: string;      // "HH:MM"
  iso: string;       // Full ISO string
}

/**
 * Resolve an Arabic date expression relative to "now" in Cairo timezone.
 * Returns an ISO string suitable for D1 storage.
 *
 * Supports:
 * - "بكره", "بكرة", "بكرة الصبح", "بكرة الساعة 3"
 * - "بعد بكره", "بعد غد", "بعد بكرة"
 * - "بعد 3 ايام", "بعد تلت ايام", "بعد خمسة أيام"
 * - "بعد اسبوع", "بعد اسبوعين", "بعد 3 اسابيع"
 * - "بعد شهر", "بعد شهرين"
 * - "السبت", "الجمعة", "الاثنين"
 * - "السبت الجاي", "الجمعة الجاية"
 * - "الكلم 15", "15/12", "2026-12-15"
 * - "اليوم", "النهارده"
 * - Time-only: "الساعة 3", "الساعة 3:30 مساءً", "الظهر"
 */
export function resolveArabicDate(
  text: string,
  referenceDate?: Date
): string | null {
  const ref = referenceDate || nowInCairo();
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const t = text.trim().toLowerCase();

  // ── Absolute date patterns ───────────────────────────
  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = t.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1]);
    const m = parseInt(isoMatch[2]);
    const d = parseInt(isoMatch[3]);
    if (y >= 2020 && y <= 2030 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const time = parseArabicTime(text);
      const hh = time ? String(time.hour).padStart(2, '0') : '00';
      const mm = time ? String(time.minute).padStart(2, '0') : '00';
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${hh}:${mm}:00.000Z`;
    }
  }

  // DD/MM or DD-MM (day/month, assume current year)
  const dmMatch = t.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (dmMatch) {
    const d = parseInt(dmMatch[1]);
    const m = parseInt(dmMatch[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const y = today.getFullYear();
      const time = parseArabicTime(text);
      const hh = time ? String(time.hour).padStart(2, '0') : '00';
      const mm = time ? String(time.minute).padStart(2, '0') : '00';
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${hh}:${mm}:00.000Z`;
    }
  }

  // "15 ديسمبر" / "15 ديسمبر" / "15 / 12"
  const arMonthMatch = t.match(
    /(\d{1,2})\s*(يناير|فبراير|مارس|ابريل|أبريل|مايو|يونيو|يوليو|اغسطس|أغسطس|سبتمبر|اكتوبر|أكتوبر|نوفمبر|ديسمبر)/
  );
  if (arMonthMatch) {
    const ARAB_MONTHS: Record<string, number> = {
      'يناير': 1, 'فبراير': 2, 'مارس': 3, 'ابريل': 4, 'أبريل': 4,
      'مايو': 5, 'يونيو': 6, 'يوليو': 7, 'اغسطس': 8, 'أغسطس': 8,
      'سبتمبر': 9, 'اكتوبر': 10, 'أكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
    };
    const d = parseInt(arMonthMatch[1]);
    const m = ARAB_MONTHS[arMonthMatch[2]];
    const y = today.getFullYear();
    if (m && d >= 1 && d <= 31) {
      const time = parseArabicTime(text);
      const hh = time ? String(time.hour).padStart(2, '0') : '00';
      const mm = time ? String(time.minute).padStart(2, '0') : '00';
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${hh}:${mm}:00.000Z`;
    }
  }

  // ── Relative: "اليوم" / "النهارده" ─────────────────
  if (/^(اليوم|النهارده|today|الное)$/i.test(t)) {
    const time = parseArabicTime(text);
    return makeISO(today, time);
  }

  // ── Relative: "بكره" / "بكرة" / "غدا" / "غداً" ────
  if (/^(بكره|بكرة|بكرة|غدا|غداً|tomorrow)$/i.test(t)) {
    const tomorrow = addDays(today, 1);
    const time = parseArabicTime(text);
    return makeISO(tomorrow, time || { hour: 9, minute: 0 });
  }

  // ── Relative: "بعد بكره" / "بعد غد" ─────────────────
  if (/^(بعد\s*(?:بكره|بكرة|بكرة|غد|غدا|غداً))$/i.test(t)) {
    const dayAfter = addDays(today, 2);
    const time = parseArabicTime(text);
    return makeISO(dayAfter, time || { hour: 9, minute: 0 });
  }

  // ── Relative: "بعد N ايام" / "بعد N يوم" ───────────
  const afterDaysMatch = t.match(
    /بعد\s*(\d+|واحدة?|اتنين|اثنين|ثلاثة?|تلاتة?|تلات|تلت|اربعة?|خمسة?|خمس|ستة?|ست|سبعة?|سبع|ثمانية?|ثمان|تمان|تمانية?|تسعة?|تسع|عشرة?|عشر|حد|حدا|حدة?)\s*(يوم|ايام|أيام|يوما)/
  );
  if (afterDaysMatch) {
    const n = parseArabicNumber(afterDaysMatch[1]);
    if (n && n > 0 && n <= 365) {
      const future = addDays(today, n);
      const time = parseArabicTime(text);
      return makeISO(future, time || { hour: 9, minute: 0 });
    }
  }

  // ── Relative: "بعد اسبوع / اسبوعين / N اسابيع" ─────
  const afterWeekMatch = t.match(
    /بعد\s*(\d+|واحدة?|اتنين|اثنين|ثلاثة?|تلاتة?|تلات|تلت|اربعة?|خمسة?|خمس|ستة?|ست|سبعة?|سبع|ثمانية?|ثمان|تمان|تمانية?|تسعة?|تسع|عشرة?|عشر|حد|حدا|حدة?)?\s*(اسبوع|اسابيع|أسبوع|أسابيع)/
  );
  if (afterWeekMatch) {
    const n = parseArabicNumber(afterWeekMatch[1] || 'واحد');
    if (n && n > 0 && n <= 52) {
      const future = addDays(today, n * 7);
      const time = parseArabicTime(text);
      return makeISO(future, time || { hour: 9, minute: 0 });
    }
  }

  // ── Relative: "بعد شهر / شهرين / N شهور" ────────────
  const afterMonthMatch = t.match(
    /بعد\s*(\d+|واحدة?|اتنين|اثنين|ثلاثة?|تلاتة?|تلات|تلت|اربعة?|خمسة?|خمس|ستة?|ست|سبعة?|سبع|ثمانية?|ثمان|تمان|تمانية?|تسعة?|تسع|عشرة?|عشر|حد|حدا|حدة?)?\s*(شهر|شهور|شهرين|شهرا)/
  );
  if (afterMonthMatch) {
    const n = parseArabicNumber(afterMonthMatch[1] || 'واحد');
    if (n && n > 0 && n <= 12) {
      const future = addMonths(today, n);
      const time = parseArabicTime(text);
      return makeISO(future, time || { hour: 9, minute: 0 });
    }
  }

  // ── Day of week: "السبت", "الجمعة الجاي", etc. ──────
  for (const [dayName, dayNum] of Object.entries(ARABIC_DAYS)) {
    if (t.includes(dayName)) {
      const isNext = /(?:الجا[يي]ة|القادم|الجاي|coming|next)/i.test(t);
      let target = addDays(today, 1);
      // Find the next occurrence of this weekday
      while (target.getDay() !== dayNum) {
        target = addDays(target, 1);
      }
      // If "الجاية" and it's today, skip to next week
      if (!isNext && target.getTime() === today.getTime()) {
        target = addDays(target, 7);
      }
      // If not "الجاية" and the day already passed this week, go to next week
      if (!isNext && target.getTime() < today.getTime()) {
        target = addDays(target, 7);
      }
      const time = parseArabicTime(text);
      return makeISO(target, time || { hour: 9, minute: 0 });
    }
  }

  // ── Time-only (assume today) ─────────────────────────
  const timeOnly = parseArabicTime(text);
  if (timeOnly && t.length < 30) {
    return makeISO(today, timeOnly);
  }

  // ── Fallback: try native Date parse as last resort ───
  try {
    const d = new Date(text);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) {
      return d.toISOString();
    }
  } catch { /* ignore */ }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function makeISO(date: Date, time: { hour: number; minute: number } | null): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = time ? String(time.hour).padStart(2, '0') : '09';
  const mm = time ? String(time.minute).padStart(2, '0') : '00';
  return `${y}-${m}-${d}T${hh}:${mm}:00.000Z`;
}
