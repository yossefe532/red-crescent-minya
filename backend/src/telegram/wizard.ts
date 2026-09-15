/**
 * Telegram Bot — Wizard State Machine
 * Handles free-text input when a wizard session is active.
 */
import { getSession, tgSend } from './bot';
import { mainMenuKeyboard } from './keyboards';
import { handleCreateTitle, handleCreateDescription, handleCreateLocation, handleCreateStart, handleCreateEnd, handleCreateCapacity, handleCreateWaitingList } from './commands/create';
import { handleCancelMissionPick, handleCancelVolunteerSelect } from './commands/cancel-reg';

/**
 * Handles wizard messages when session state is not idle.
 * Returns true if the wizard handled the message, false otherwise.
 */
export async function handleWizardMessage(
  token: string,
  chatId: number,
  db: D1Database,
  text: string
): Promise<boolean> {
  const session = await getSession(db, chatId);
  if (session.state === 'idle') return false;

  switch (session.state) {
    // ─── Create Mission Wizard ────────────────────────────────
    case 'create_title':
      await handleCreateTitle(token, chatId, db, text);
      return true;
    case 'create_description':
      await handleCreateDescription(token, chatId, db, text);
      return true;
    case 'create_location':
      await handleCreateLocation(token, chatId, db, text);
      return true;
    case 'create_start':
      await handleCreateStart(token, chatId, db, text);
      return true;
    case 'create_end':
      await handleCreateEnd(token, chatId, db, text);
      return true;
    case 'create_capacity':
      await handleCreateCapacity(token, chatId, db, text);
      return true;
    case 'create_waitlist':
      await handleCreateWaitingList(token, chatId, db, text);
      return true;

    // ─── Delete Confirmation ──────────────────────────────────
    case 'delete_confirm':
      // In delete_confirm state, text input is not expected - only callback buttons.
      await tgSend(token, chatId,
        '⚠️ استخدم الأزرار بالأسفل للتأكيد أو الإلغاء.',
        { reply_markup: mainMenuKeyboard() }
      );
      return true;

    // ─── Cancel Registration Wizard ───────────────────────────
    case 'cancelreg_select_mission':
      await handleCancelMissionPick(token, chatId, db, text);
      return true;
    case 'cancelreg_select_volunteer':
      await handleCancelVolunteerSelect(token, chatId, db, text);
      return true;
    case 'cancelreg_confirm':
      await tgSend(token, chatId,
        '⚠️ استخدم الأزرار بالأسفل للتأكيد.',
        { reply_markup: mainMenuKeyboard() }
      );
      return true;

    // ─── Search Input ─────────────────────────────────────────
    case 'search_input': {
      const searchData = session.data;
      if (!searchData?.searchType) {
        await tgSend(token, chatId, '❌ حدث خطأ. جرب من جديد.', {
          reply_markup: mainMenuKeyboard(),
        });
        return true;
      }
      // Import and execute search
      const { executeSearch } = await import('./callbacks');
      await executeSearch(token, chatId, db, text, searchData.searchType as string, 1);
      return true;
    }

    // ─── Edit Mission Value ───────────────────────────────────
    case 'edit_value': {
      const { missionId, editField } = session.data;
      if (!missionId || !editField) {
        await tgSend(token, chatId, '❌ حدث خطأ. جرب من جديد.', {
          reply_markup: mainMenuKeyboard()
        });
        return true;
      }
      const { handleEditValue } = await import('./commands/edit');
      await handleEditValue(token, chatId, db, missionId, editField, text);
      return true;
    }

    // ─── Requirements & Questions Management ──────────────────
    case 'req_text': {
      const { handleRequirementText } = await import('./commands/requirements');
      await handleRequirementText(token, chatId, db, text);
      return true;
    }
    case 'q_type': {
      // q_type is handled via callback buttons (questionTypeKeyboard).
      await tgSend(token, chatId,
        '⚠️ استخدم الأزرار لاختيار نوع السؤال، ثم اكتب نص السؤال.',
        { reply_markup: mainMenuKeyboard() }
      );
      return true;
    }
    case 'q_text': {
      const { handleQuestionText } = await import('./commands/requirements');
      await handleQuestionText(token, chatId, db, text);
      return true;
    }
    case 'q_options': {
      const { handleQuestionOptions } = await import('./commands/requirements');
      await handleQuestionOptions(token, chatId, db, text);
      return true;
    }

    default:
      return false;
  }
}