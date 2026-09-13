/**
 * Telegram Bot — Start Command Handler
 * /start, /help, /cancel
 */
import { clearSession, tgSend } from '../bot';
import { helpText } from '../formatters';
import { mainMenuKeyboard, publicUserKeyboard } from '../keyboards';
import { isAdmin } from '../auth';

export async function startCommandHandler(
  token: string,
  chatId: number,
  db: D1Database,
  adminChatIds: string = ''
): Promise<void> {
  await clearSession(db, chatId);

  if (isAdmin(chatId, adminChatIds)) {
    const adminWelcomeText =
      `🏥 <b>لوحة إدارة الهلال الأحمر المصري — فرع المنيا</b>\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `مرحباً بك في النظام الإداري الموحد لإدارة المهام التطوعية والمتطوعين.\n\n` +
      `📋 <b>الخيارات المتاحة:</b>\n` +
      `• <b>📋 المهام:</b> استعراض وتعديل وإغلاق وفتح وحذف المهام\n` +
      `• <b>➕ إنشاء مهمة:</b> معالج إنشاء مهمة تطوعية جديدة\n` +
      `• <b>👥 المتطوعون:</b> متابعة المقبولين والانتظار والاستماع للتسجيل الصوتي\n` +
      `• <b>🔔 الإشعارات:</b> التحكم في تنبيهات التسجيل الفورية\n` +
      `• <b>📊 الإحصائيات:</b> تقرير فوري بالأعداد وحالة التسجيل\n` +
      `• <b>🏥 فحص النظام:</b> التحقق من سلامة قاعدة البيانات والخدمات\n\n` +
      `اختر من القائمة أدناه للبدء 👇`;

    await tgSend(token, chatId, adminWelcomeText, {
      reply_markup: mainMenuKeyboard(),
    });
  } else {
    const publicWelcomeText =
      `🏥 <b>الهلال الأحمر المصري — فرع المنيا</b>\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `أهلاً بك! هذا البوت مخصص لإدارة وإشراف المهام التطوعية.\n\n` +
      `للتسجيل في المهام التطوعية والمبادرات القادمة، يرجى زيارة بوابة التسجيل الإلكترونية عبر الرابط أدناه:\n\n` +
      `🌐 https://red-crescent-minya.pages.dev`;

    await tgSend(token, chatId, publicWelcomeText, {
      reply_markup: publicUserKeyboard(),
    });
  }
}

export async function helpCommandHandler(
  token: string,
  chatId: number,
  db: D1Database,
  adminChatIds: string = ''
): Promise<void> {
  if (isAdmin(chatId, adminChatIds)) {
    await tgSend(token, chatId, helpText(), {
      reply_markup: mainMenuKeyboard(),
    });
  } else {
    await tgSend(
      token,
      chatId,
      `ℹ️ <b>المساعدة والدعم</b>\n\n` +
      `بوابة التسجيل: https://red-crescent-minya.pages.dev\n` +
      `للتواصل مع إدارة فرع المنيا يرجى مراجعة المقر الرئيسي.`,
      { reply_markup: publicUserKeyboard() }
    );
  }
}

export async function cancelCommandHandler(
  token: string,
  chatId: number,
  db: D1Database,
  adminChatIds: string = ''
): Promise<void> {
  await clearSession(db, chatId);
  if (isAdmin(chatId, adminChatIds)) {
    await tgSend(token, chatId, '🏠 <b>تم الإلغاء والعودة للرئيسية.</b>', {
      reply_markup: mainMenuKeyboard(),
    });
  } else {
    await tgSend(token, chatId, '🏠 <b>تم الإلغاء.</b>', {
      reply_markup: publicUserKeyboard(),
    });
  }
}
