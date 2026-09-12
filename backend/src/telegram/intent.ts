/**
 * Telegram Bot — Intent Parser
 * Unified AI + rule-based intent parser for Egyptian Arabic.
 */
import { ParsedIntent, IntentType } from './types';
import { resolveArabicDate } from './dateResolver';

// ─── Rule-Based Intent Parser (Egyptian Arabic) ────────────────
function parseWithRules(text: string): ParsedIntent {
  const t = text.trim().toLowerCase();
  const extracted: ParsedIntent['extracted'] = {};

  // Extract MNY-XXX codes
  const codeMatch = text.match(/MNY-?(\\d+)/i);
  if (codeMatch) extracted.missionCode = `MNY-${codeMatch[1]}`;

  // Extract member numbers (4+ digits, or preceded by keywords)
  const memberMatch = text.match(/(?:رقم\\s*عضوية?\\s*|عضوية\\s*|auf\\s*|num\\s*)(\\d+)/i)
    || text.match(/(\\d{4,})/); // 4+ digit number likely a member ID
  if (memberMatch) extracted.memberNumber = memberMatch[1];

  // Extract capacity (keywords: عدد, سِعه, سعة, capacity, شخص, فرد, volunt)
  const capMatch = text.match(/(?:عدد|سِعه|سعة|capacity|handasa\\s*)(\\d+)/i)
    || text.match(/(\\d+)\\s*(?:شخص|فرد|volunt)/i);
  if (capMatch) extracted.capacity = parseInt(capMatch[1]);

  // ─── Intent classification (Egyptian Arabic patterns) ────
  // Create mission patterns
  if (
    /(?:اعمل|عمل|انشئ|انشاء|اقرأ|فتح|ابدأ|اصنع|سجّل|سجفل)\\s*(?:مهم[ةه]|مهمت)/.test(t)
    || /مهم[ةه]\\s*جديدة/.test(t)
    || /(?:create|new)\\s*mission/.test(t)
  ) {
    extracted.missionHint = text;
    // Try to extract title from the message
    const titleMatch = text.match(
      /(?:اسم(?:ها|ه)?\\s*|عنوان[هاه]?\\s*[:：]?\\s*)(.+?)(?:\\s+في\\s|\\s+ب\\s|\\s+capacity|\\s+عدد|$)/i
    )
      || text.match(/مهم[ةه]\\s*(?:اسم(?:ها|ه)?\\s*)?[:：]?\\s*(.+?)(?:\\s+في\\s|\\s+ب\\s|\\s+عدد|$)/i);
    if (titleMatch) {
      let rawTitle = titleMatch[1].trim();
      // Cleanup: strip stray leading \"ا \" / \"أ \" (regex/LLM artifact)
      rawTitle = rawTitle.replace(/^(ا|أ)\\s+/i, '').trim();
      // Discard generic placeholders like \"جديدة\" / \"new\" — not a real title
      if (!/^(جديدة?|new|جديد|مهمة|مهمه|واحدة|واحد|عمل)$/i.test(rawTitle)) {
        extracted.title = rawTitle;
      }
    }
    const locMatch = text.match(/(?:في|بـ|ب|at|in)\\s+(.+?)(?:\\s+عدد|\\s+capacity|$)/i);
    if (locMatch) extracted.location = locMatch[1].trim();
    return { intent: 'create_mission', confidence: 0.9, extracted };
  }

  // List missions
  if (
    /(?:شوف|عرض|اوريك|وريني|.List|all\\s*mission)/.test(t)
    || /مهم[ةه]ت?ي?ن?\\s*(?:models|كل|الكل)/.test(t)
  ) {
    if (
      /(?:نشيطة|-active|current|الحالية)/.test(t)
    ) {
      return { intent: 'list_active', confidence: 0.9, extracted };
    }
    return { intent: 'list_missions', confidence: 0.9, extracted };
  }

  // Stats
  if (
    /(?:احصائيات|statistics|stats|إحصاء|تقرير)/.test(t)
  ) {
    return { intent: 'stats', confidence: 0.9, extracted };
  }

  // Status (bot status)
  if (
    /(?:حالة|status|الحالة|bot\\s*status)/.test(t)
  ) {
    return { intent: 'status', confidence: 0.9, extracted };
  }

  // Help
  if (
    /(?:مساعدة|help|guid|tutorial|ازاي|usage)/.test(t)
  ) {
    return { intent: 'help', confidence: 0.95, extracted };
  }

  // Delete mission
  if (
    /(?:امسح|حذف|شيل|askh|remove|delete)\\s*(?:مهم[ةه]|mission)/.test(t)
    || /حذف\\s*(?:مهم[ةه])/.test(t)
  ) {
    return { intent: 'delete_mission', confidence: 0.9, extracted };
  }

  // Close mission
  if (
    /(?:اقفل|غلق|close|stop)\\s*(?:مهم[ةه]|registration|التسجيل)/.test(t)
    || /(?:اقفال|إغلاق)\\s*(?:التسجيل|registration)/.test(t)
  ) {
    return { intent: 'close_mission', confidence: 0.85, extracted };
  }

  // Open mission (toggle)
  if (
    /(?:افتح|فتح)\\s*(?:مهم[ةه]|التسجيل)/.test(t)
  ) {
    return { intent: 'open_mission', confidence: 0.9, extracted };
  }

  // Edit mission
  if (
    /(?:عدّل|عديل|تعديل|edit|change|modify)\\s*(?:مهم[ةه]|mission)/.test(t)
  ) {
    return { intent: 'edit_mission', confidence: 0.9, extracted };
  }

  // Export CSV
  if (
    /(?:تصدير|csv|export)\\s*(?:مهم[ةه]|mission|التسجيلات)/.test(t)
  ) {
    return { intent: 'export_csv', confidence: 0.9, extracted };
  }

  // Get link
  if (
    /(?:رابط|link|url)\\s*(?:مهم[ةه]|mission|التسجيل)/.test(t)
  ) {
    return { intent: 'get_link', confidence: 0.9, extracted };
  }

  // Cancel registration
  if (
    /(?:شيل|الغي|الغاء|الغِ|cancel|حذف\\s*تسجيل)/.test(t)
    && (/(?:متطوع|volunteer|عضو|asha3|تسجيل|vol)/.test(t) || extracted.memberNumber)
  ) {
    return { intent: 'cancel_registration', confidence: 0.9, extracted };
  }

  // View waitlist
  if (
    /(?:انتظار|waitlist|waiting|الانتظار|قائمه\\s*الانتظار)/.test(t)
  ) {
    return { intent: 'view_waitlist', confidence: 0.85, extracted };
  }

  // View registrants
  if (
    /(?:متطوعين|المسجلين|registered|volunteers|تسجيلات|المشاركين)/.test(t)
  ) {
    return { intent: 'view_registrants', confidence: 0.85, extracted };
  }

  // Default unknown
  return { intent: 'unknown', confidence: 0.2, extracted };
}

// ─── Fix year in date strings (2001→2026, etc.) ──────────────
function fixYear(dateStr: string): string | null {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    // If year is before 2024, fix to current year
    if (d.getFullYear() < 2024) {
      const now = new Date();
      d.setFullYear(now.getFullYear());
      // If the resulting date is in the past, try next year
      if (d.getTime() < now.getTime()) {
        d.setFullYear(now.getFullYear() + 1);
      }
      return d.toISOString();
    }
    return null; // Year is fine, no fix needed
  } catch {
    return null;
  }
}

// ─── AI Intent Parser (Cloudflare Workers AI) ────────────────
async function parseWithAI(text: string, ai?: any): Promise<ParsedIntent | null> {
  if (!ai) return null;

  // Get current date/time in Cairo for the AI prompt
  const now = new Date();
  const cairoNow = new Date(now.getTime() + (3 * 60 * 60 * 1000)); // Approx Cairo UTC+3
  const todayStr = cairoNow.toISOString().split('T')[0]; // "YYYY-MM-DD"
  const dayOfWeek = cairoNow.toLocaleDateString('ar-EG', { weekday: 'long', timeZone: 'Africa/Cairo' });

  const prompt = `أنت مساعد ذكي لتطبيق إدارة مهام الإسعاف.
حلل الرسالة التالية واستخرج النية والبيانات.

⏰ التاريخ الحالي: ${todayStr} (${dayOfWeek})
⚠️Important: You MUST use the year 2026 for all dates. Current year is 2026.

الرسالة: \"${text}\"

أجب بالـ JSON التالي فقط (بدون أي نص إضافي):
{
  \"intent\": \"create_mission|list_missions|list_active|stats|status|help|open_mission|close_mission|delete_mission|cancel_registration|view_waitlist|view_registrants|edit_mission|export_csv|get_link|unknown\",
  \"confidence\": 0.0-1.0,
  \"extracted\": {
    \"title\": \"اسم المهمة إن وُجد (نظيف بدون حروف زائدة)\",
    \"location\": \"المكان إن وُجد (بدون الوقت)\",
    \"time\": \"الوقت/الميعاد إن وُجد مثل الساعة 3 أو 15:00\",
    \"capacity\": رقم إن وُجد,
    \"missionCode\": \"كود المهمة MNY-XXX إن وُجد\",
    \"memberNumber\": \"رقم العضوية إن وُجد\",
    \"missionHint\": \"أي ذكر للمهمة\"
  }
}

أمثلة (مع الحالية ${todayStr}):
- \"اعمل مهمه اسمها اسعاف حادث في ديرمواس الساعه 3\" → intent: create_mission, extracted: {title: \"إسعاف حادث\", location: \"ديرمواس\", time: \"الساعة 3\", capacity: null}
- \"شوف المهمات\" → intent: list_missions
- \"شيل أحمد رقم عضويته 123 من مهمه MNY-379\" → intent: cancel_registration, extracted: {memberNumber: \"123\", missionCode: \"MNY-379\"}
- \"ابعتلي احصائيات\" → intent: stats
- \"امسح مهمه MNY-171\" → intent: delete_mission, extracted: {missionCode: \"MNY-171\"}
- \"فتح التسجيل في المهمه\" → intent: open_mission
- \"عدّل مهمة MNY-123\" → intent: edit_mission, extracted: {missionHint: \"MNY-123\"}
- \"تصدير MNY-456\" → intent: export_csv, extracted: {missionCode: \"MNY-456\"}
- \"رابط MNY-789\" → intent: get_link, extracted: {missionCode: \"MNY-789\"}
`;

  try {
    const result = await ai.run('@cf/meta/llama-3.1-8b-instruct-fp8', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 0.1,
    });

    const rawOutput = result?.response ?? '';
    // Extract JSON from the response
    const jsonMatch = rawOutput.match(/\\{[\\s\\S]*\\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as ParsedIntent;

    // ─── Post-processing: clean LLM output ───────────────────
    if (parsed.extracted) {
      // Remove stray leading \"ا \" or \"أ \" from titles (LLM artifact)
      if (parsed.extracted.title) {
        parsed.extracted.title = parsed.extracted.title.replace(/^(ا|أ)\\s+/i, '').trim();
      }
      // If location still contains time, separate it
      if (parsed.extracted.location && !parsed.extracted.time) {
        const timeMatch = parsed.extracted.location.match(
          /(?:الساعة|الساعه|على الساعة|فى الساعة|في الساعة)\\s*(\\d{1,2}(?::\\d{2})?\\s*(?:صباحاً|مساءً|ص|م)?)/i
        );
        if (timeMatch) {
          parsed.extracted.time = `الساعة ${timeMatch[1].trim()}`;
          parsed.extracted.location = parsed.extracted.location.replace(
            /(?:،|\\s)+(?:الساعة|الساعه|على الساعة|فى الساعة|في الساعة)\\s*\\d{1,2}(?::\\d{2})?\\s*(?:صباحاً|مساءً|ص|م)?/i,
            ''
          ).trim();
        }
      }
      // ── Fix year: if AI returned dates with wrong year (e.g. 2001), fix to current
      if ((parsed.extracted as any).start_at) {
        const fixed = fixYear((parsed.extracted as any).start_at);
        if (fixed) (parsed.extracted as any).start_at = fixed;
      }
      if ((parsed.extracted as any).end_at) {
        const fixed = fixYear((parsed.extracted as any).end_at);
        if (fixed) (parsed.extracted as any).end_at = fixed;
      }
      // ── Resolve Arabic relative dates in extracted fields ──
      if ((parsed.extracted as any).start_at && !(parsed.extracted as any).start_at.includes('T')) {
        const resolved = resolveArabicDate((parsed.extracted as any).start_at);
        if (resolved) (parsed.extracted as any).start_at = resolved;
      }
      if ((parsed.extracted as any).end_at && !(parsed.extracted as any).end_at.includes('T')) {
        const resolved = resolveArabicDate((parsed.extracted as any).end_at);
        if (resolved) (parsed.extracted as any).end_at = resolved;
      }
    }
    return parsed;
  } catch (e) {
    console.warn('AI parse failed, falling back to rules:', e);
    return null;
  }
}

// ─── Main Intent Parser ───────────────────────────────────────
export async function parseIntent(
  text: string,
  ai?: any
): Promise<ParsedIntent> {
  // Try AI first if available
  if (ai) {
    const aiResult = await parseWithAI(text, ai);
    if (aiResult && aiResult.confidence > 0.5) {
      return aiResult;
    }
  }
  // Fallback: rule-based Egyptian Arabic intent parsing
  return parseWithRules(text);
}