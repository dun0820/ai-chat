import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, isValidSessionId } from "@/lib/session";
import { proxy } from "./proxy";

describe("proxy", () => {
  it("issues a new session cookie when none exists", () => {
    const request = new NextRequest("http://localhost:3000/");

    const response = proxy(request);
    const cookie = response.cookies.get(SESSION_COOKIE_NAME);

    expect(cookie).toBeDefined();
    expect(isValidSessionId(cookie?.value)).toBe(true);
  });

  it("does not overwrite an existing valid session cookie", () => {
    const existingId = "c0a88946-400f-43e0-8543-31006d93ad9c";
    const request = new NextRequest("http://localhost:3000/", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${existingId}` },
    });

    const response = proxy(request);

    expect(response.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("issues a fresh session cookie when the existing one is malformed", () => {
    const request = new NextRequest("http://localhost:3000/", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=not-a-valid-uuid` },
    });

    const response = proxy(request);
    const cookie = response.cookies.get(SESSION_COOKIE_NAME);

    expect(cookie).toBeDefined();
    expect(cookie?.value).not.toBe("not-a-valid-uuid");
    expect(isValidSessionId(cookie?.value)).toBe(true);
  });

  it("propagates the newly issued session id to the current request's cookies", () => {
    const request = new NextRequest("http://localhost:3000/");

    const response = proxy(request);
    const responseCookie = response.cookies.get(SESSION_COOKIE_NAME);

    // NextResponse.next({ request }) を使っているため、同一リクエスト内の
    // 後続ハンドラ（Hono API等）にも同じCookie値が見える必要がある
    expect(request.cookies.get(SESSION_COOKIE_NAME)?.value).toBe(
      responseCookie?.value,
    );
  });

  it("sets httpOnly, sameSite=lax and a 30-day maxAge on the issued cookie", () => {
    const request = new NextRequest("http://localhost:3000/");

    const response = proxy(request);
    const cookie = response.cookies.get(SESSION_COOKIE_NAME);

    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.maxAge).toBe(60 * 60 * 24 * 30);
  });
});
