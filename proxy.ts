import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE,
  generateSessionId,
  isValidSessionId,
} from "@/lib/session";

export function proxy(request: NextRequest) {
  const existing = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (isValidSessionId(existing)) {
    return NextResponse.next();
  }

  const sessionId = generateSessionId();

  // このリクエスト自身（ページ / API Route ハンドラ）にも新しいCookieを見せる
  request.cookies.set(SESSION_COOKIE_NAME, sessionId);
  const response = NextResponse.next({ request });

  // ブラウザにはSet-Cookieヘッダーで返す
  response.cookies.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_MAX_AGE,
    path: "/",
  });

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
