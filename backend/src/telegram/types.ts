/**
 * Telegram Bot — Type Definitions
 * Single source of truth for all Telegram-related types.
 */

// ─── Wizard Session State ──────────────────────────────────────
export type WizardState =
  | 'idle'
  // Create mission wizard
  | 'create_title'
  | 'create_description'
  | 'create_location'
  | 'create_start'
  | 'create_end'
  | 'create_capacity'
  | 'create_waitlist'
  | 'create_confirm'
  // Delete mission
  | 'delete_confirm'
  // Edit mission
  | 'edit_select_field'
  | 'edit_value'
  // Cancel registration
  | 'cancelreg_select_mission'
  | 'cancelreg_select_volunteer'
  | 'cancelreg_confirm';

export interface WizardData {
  title?: string;
  description?: string | null;
  location?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  capacity?: number;
  waiting_list?: number;
  missionId?: string;
  missionCode?: string;
  volunteerId?: string;
  volunteerName?: string;
  registrationId?: string;
  editField?: string;
  [key: string]: unknown;
}

// ─── Session Row (D1 storage) ──────────────────────────────────
export interface SessionRow {
  chat_id: number;
  state: string;
  data: string; // JSON
  updated_at: string;
}

// ─── AI Intent Types ───────────────────────────────────────────
export type IntentType =
  | 'create_mission'
  | 'list_missions'
  | 'list_active'
  | 'stats'
  | 'status'
  | 'help'
  | 'open_mission'
  | 'close_mission'
  | 'delete_mission'
  | 'cancel_registration'
  | 'view_waitlist'
  | 'view_registrants'
  | 'edit_mission'
  | 'export_csv'
  | 'get_link'
  | 'unknown';

export interface ParsedIntent {
  intent: IntentType;
  confidence: number;
  extracted: {
    title?: string;
    location?: string;
    time?: string;
    capacity?: number;
    missionCode?: string;
    memberNumber?: string;
    missionHint?: string;
  };
}

// ─── Telegram Update Types (minimal) ───────────────────────────
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from?: { id: number; username?: string; first_name?: string };
  chat: { id: number; type: string };
  text?: string;
  date: number;
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number; username?: string; first_name?: string };
  message?: TelegramMessage;
  data?: string;
}
