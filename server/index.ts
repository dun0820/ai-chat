import { Hono } from "hono";
import { getSessionId } from "@/server/lib/session";
import { chat } from "@/server/routes/chat";

export const app = new Hono().basePath("/api");

app.get("/health", (c) => c.json({ status: "ok" }));

// Phase 2の動作確認用（セッションCookieが読めているかの疎通確認）
app.get("/session", (c) => c.json({ sessionId: getSessionId(c) }));

app.route("/", chat);
