import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { SESSION_COOKIE_NAME, isValidSessionId } from "@/lib/session";
import { getSessionId } from "./session";

function buildTestApp() {
  const app = new Hono();
  app.get("/test", (c) => c.json({ sessionId: getSessionId(c) }));
  return app;
}

describe("getSessionId", () => {
  it("returns the id from an existing valid cookie without setting a new one", async () => {
    const app = buildTestApp();
    const existingId = "c0a88946-400f-43e0-8543-31006d93ad9c";

    const res = await app.request("/test", {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${existingId}` },
    });
    const body = await res.json();

    expect(body.sessionId).toBe(existingId);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("issues and sets a new session id when no cookie is present", async () => {
    const app = buildTestApp();

    const res = await app.request("/test");
    const body = await res.json();

    expect(isValidSessionId(body.sessionId)).toBe(true);
    expect(res.headers.get("Set-Cookie")).toContain(SESSION_COOKIE_NAME);
  });

  it("issues and sets a new session id when the existing cookie is malformed", async () => {
    const app = buildTestApp();

    const res = await app.request("/test", {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=garbage-value` },
    });
    const body = await res.json();

    expect(isValidSessionId(body.sessionId)).toBe(true);
    expect(body.sessionId).not.toBe("garbage-value");
  });

  it("returns different ids for two requests with no cookie (independent sessions)", async () => {
    const app = buildTestApp();

    const [resA, resB] = await Promise.all([
      app.request("/test"),
      app.request("/test"),
    ]);
    const [bodyA, bodyB] = await Promise.all([resA.json(), resB.json()]);

    expect(bodyA.sessionId).not.toBe(bodyB.sessionId);
  });
});
