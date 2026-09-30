import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { personaAgent } from "@/mastra/agents/persona";
import { getOrCreateSession, getSessionMessages } from "@/lib/session-store";
import { prisma } from "@/lib/prisma";
import { getSessionId } from "@/server/lib/session";

export const chat = new Hono();

// Claude APIが受け付ける画像形式
const ALLOWED_IMAGE_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];
// Base64エンコード後のサイズ上限(元データ換算で約5MB)
const MAX_IMAGE_DATA_LENGTH = Math.ceil((5 * 1024 * 1024 * 4) / 3);

type IncomingImage = { data: string; mediaType: string };

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string };

type ConversationMessage =
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string };

function toUserContent(
  content: string,
  image?: { data: string; mediaType: string } | null,
): string | ContentPart[] {
  if (!image) return content;

  // data URL自体にmedia typeが埋め込まれるため、別途mediaTypeフィールドを渡す必要がない
  const parts: ContentPart[] = [];
  if (content) parts.push({ type: "text", text: content });
  parts.push({
    type: "image",
    image: `data:${image.mediaType};base64,${image.data}`,
  });
  return parts;
}

function isValidImage(image: unknown): image is IncomingImage {
  if (typeof image !== "object" || image === null) return false;
  const { data, mediaType } = image as Record<string, unknown>;
  if (typeof data !== "string" || !data) return false;
  if (
    typeof mediaType !== "string" ||
    !ALLOWED_IMAGE_MEDIA_TYPES.includes(mediaType)
  ) {
    return false;
  }
  return data.length <= MAX_IMAGE_DATA_LENGTH;
}

chat.get("/messages", async (c) => {
  const sessionId = getSessionId(c);
  const messages = await getSessionMessages(sessionId);

  return c.json({
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      image: m.imageData
        ? { data: m.imageData, mediaType: m.imageMediaType }
        : null,
      createdAt: m.createdAt,
    })),
  });
});

chat.post("/chat", async (c) => {
  const sessionId = getSessionId(c);
  const body = await c.req
    .json<{ message?: unknown; image?: unknown }>()
    .catch(() => null);

  if (typeof body?.message !== "string") {
    return c.json({ error: "message is required" }, 400);
  }
  const message = body.message.trim();

  let image: IncomingImage | null = null;
  if (body.image !== undefined && body.image !== null) {
    if (!isValidImage(body.image)) {
      return c.json({ error: "invalid image" }, 400);
    }
    image = body.image;
  }

  if (!message && !image) {
    return c.json({ error: "message or image is required" }, 400);
  }

  const session = await getOrCreateSession(sessionId);
  const history = await getSessionMessages(sessionId);

  const conversationMessages: ConversationMessage[] = [
    ...history.map((m) =>
      m.role === "user"
        ? {
            role: "user" as const,
            content: toUserContent(
              m.content,
              m.imageData && m.imageMediaType
                ? { data: m.imageData, mediaType: m.imageMediaType }
                : null,
            ),
          }
        : { role: "assistant" as const, content: m.content },
    ),
    { role: "user" as const, content: toUserContent(message, image) },
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
        data: {
          sessionId: session.id,
          role: "user",
          content: message,
          imageData: image?.data,
          imageMediaType: image?.mediaType,
        },
      });
      await prisma.message.create({
        data: { sessionId: session.id, role: "assistant", content: fullText },
      });
    } catch (error) {
      console.error("Failed to save chat messages:", error);
    }
  });
});
