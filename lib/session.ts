export const SESSION_COOKIE_NAME =
  process.env.SESSION_COOKIE_NAME || "ai_chat_session";

// ブラウザを閉じても会話履歴を再訪時に復元できるよう、30日間保持する
export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function generateSessionId(): string {
  return crypto.randomUUID();
}

export function isValidSessionId(
  value: string | undefined | null,
): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}
