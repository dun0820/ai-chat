import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { personaAgent } from "@/mastra/agents/persona";
import { getOrCreateSession, getSessionMessages } from "@/lib/session-store";
import { prisma } from "@/lib/prisma";
import { getSessionId } from "@/server/lib/session";

export const chat = new Hono();

chat.get("/messages", async (c) => {
  const sessionId = getSessionId(c);
  const messages = await getSessionMessages(sessionId);

  return c.json({
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
  });
});

chat.post("/chat", async (c) => {
  const sessionId = getSessionId(c);
  const body = await c.req.json<{ message?: unknown }>().catch(() => null);
  const message = body?.message;

  if (typeof message !== "string" || !message.trim()) {
    return c.json({ error: "message is required" }, 400);
  }

  const session = await getOrCreateSession(sessionId);
  const history = await getSessionMessages(sessionId);

  const conversationMessages: Array<
    { role: "user"; content: string } | { role: "assistant"; content: string }
  > = [
    ...history.map((m) =>
      m.role === "user"
        ? { role: "user" as const, content: m.content }
        : { role: "assistant" as const, content: m.content },
    ),
    { role: "user" as const, content: message },
  ];

  let agentStream: Awaited<ReturnType<typeof personaAgent.stream>>;
  try {
    agentStream = await personaAgent.stream(conversationMessages);
  } catch (error) {
    console.error("Failed to start agent stream:", error);
    return c.json({ error: "AIの応答生成に失敗しました" }, 502);
  }

  return streamText(c, async (stream) => {
    let fullText = "";
    try {
      for await (const chunk of agentStream.textStream) {
        fullText += chunk;
        await stream.write(chunk);
      }
    } catch (error) {
      console.error("Error while streaming agent response:", error);
      return;
    }

    try {
      // 順番にcreateし、createdAtの前後関係(user→assistant)を保証する
      await prisma.message.create({
        data: { sessionId: session.id, role: "user", content: message },
      });
      await prisma.message.create({
        data: { sessionId: session.id, role: "assistant", content: fullText },
      });
    } catch (error) {
      console.error("Failed to save chat messages:", error);
    }
  });
});
