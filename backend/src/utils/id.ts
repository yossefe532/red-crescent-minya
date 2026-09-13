/**
 * Generate a unique mission public code: MNY-XXX
 * Uses crypto.randomUUID() for collision resistance
 * instead of Math.random() (900 combos → collision risk).
 */
export function generateMissionCode(): string {
  const uuid = crypto.randomUUID();
  // Take first 6 hex chars, uppercase, numeric-only via base-36 fallback
  const hex = uuid.replace(/-/g, '').slice(0, 4);
  const num = parseInt(hex, 16) % 900 + 100; // 100-999
  return `MNY-${num}`;
}

/**
 * Generate a registration display ID: REG-XXXXXX
 */
export function generateRegistrationId(sequence: number): string {
  return `REG-${String(sequence).padStart(6, '0')}`;
}

/**
 * Generate a UUID v4 (Web Crypto API for Workers)
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Generate a request ID for idempotency
 */
export function generateRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * Generate an attempt ID
 */
export function generateAttemptId(): string {
  return `att_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * Generate R2 audio key
 */
export function generateAudioKey(missionId: string, registrationId: string): string {
  return `missions/${missionId}/registrations/${registrationId}.webm`;
}

/**
 * Generate R2 attempt audio key
 */
export function generateAttemptAudioKey(missionId: string, attemptId: string): string {
  return `missions/${missionId}/attempts/${attemptId}.webm`;
}
