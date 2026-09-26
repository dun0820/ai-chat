import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE,
  generateSessionId,
  isValidSessionId,
} from "@/lib/session";

/**
 * セッションIDを取得する。proxy.tsが常にCookieを発行しているため
 * 通常はCookieから読むだけだが、万一欠落/不正な場合はここで新規発行する。
 */
export function getSessionId(c: Context): string {
  const existing = getCookie(c, SESSION_COOKIE_NAME);

  if (isValidSessionId(existing)) {
    return existing;
  }

  const sessionId = generateSessionId();
  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_MAX_AGE,
    path: "/",
  });
  return sessionId;
}
