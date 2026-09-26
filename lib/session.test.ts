import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_MAX_AGE,
  SESSION_COOKIE_NAME,
  generateSessionId,
  isValidSessionId,
} from "./session";

describe("generateSessionId", () => {
  it("generates a value accepted by isValidSessionId", () => {
    expect(isValidSessionId(generateSessionId())).toBe(true);
  });

  it("generates unique values across many calls", () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateSessionId()));
    expect(ids.size).toBe(200);
  });
});

describe("isValidSessionId", () => {
  it("accepts a well-formed lowercase UUID", () => {
    expect(isValidSessionId("c0a88946-400f-43e0-8543-31006d93ad9c")).toBe(true);
  });

  it("accepts a well-formed uppercase UUID", () => {
    expect(isValidSessionId("C0A88946-400F-43E0-8543-31006D93AD9C")).toBe(true);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["plain text", "not-a-uuid"],
    ["missing segments", "c0a88946-400f-43e0-8543"],
    ["one character too long", "c0a88946-400f-43e0-8543-31006d93ad9cx"],
    ["wrong hyphen positions", "c0a88946400f-43e0-8543-31006d93ad9c"],
    ["injection-style string", "'; DROP TABLE sessions; --"],
  ])("rejects %s", (_label, value) => {
    expect(isValidSessionId(value)).toBe(false);
  });
});

describe("SESSION_COOKIE_NAME", () => {
  it("defaults to ai_chat_session when the env var is unset", () => {
    expect(SESSION_COOKIE_NAME).toBe("ai_chat_session");
  });
});

describe("SESSION_COOKIE_MAX_AGE", () => {
  it("is 30 days expressed in seconds", () => {
    expect(SESSION_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 30);
  });
});
