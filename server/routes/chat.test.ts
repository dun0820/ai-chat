import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/lib/session";

type FakeMessage = {
  role: "user" | "assistant";
  content: string;
  imageData?: string | null;
  imageMediaType?: string | null;
  createdAt: Date;
};
type FakeSession = { id: string; messages: FakeMessage[] };

// 実際のPrisma/MongoDBの代わりに、トークンごとに履歴を保持するインメモリの
// フェイクを使う。getOrCreateSession/getSessionMessages(lib/session-store)と
// prisma.message.create(lib/prisma)の両方から同じ店(sessionsByToken)を
// 参照させることで、chat.ts が実装しているセッション分離ロジックを
// エンドツーエンドに近い形で検証できる。
const { sessionsByToken, sessionIdToToken } = vi.hoisted(() => ({
  sessionsByToken: new Map<string, FakeSession>(),
  sessionIdToToken: new Map<string, string>(),
}));

vi.mock("@/lib/session-store", () => ({
  getOrCreateSession: vi.fn(async (token: string) => {
    let session = sessionsByToken.get(token);
    if (!session) {
      session = { id: `session-${token}`, messages: [] };
      sessionsByToken.set(token, session);
      sessionIdToToken.set(session.id, token);
    }
    return { id: session.id, token, createdAt: new Date() };
  }),
  getSessionMessages: vi.fn(async (token: string) => {
    return sessionsByToken.get(token)?.messages ?? [];
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            sessionId: string;
            role: "user" | "assistant";
            content: string;
            imageData?: string | null;
            imageMediaType?: string | null;
          };
        }) => {
          const token = sessionIdToToken.get(data.sessionId);
          if (!token) {
            throw new Error(`unknown internal session id: ${data.sessionId}`);
          }
          const session = sessionsByToken.get(token)!;
          const message: FakeMessage = {
            role: data.role,
            content: data.content,
            imageData: data.imageData ?? null,
            imageMediaType: data.imageMediaType ?? null,
            createdAt: new Date(),
          };
          session.messages.push(message);
          return message;
        },
      ),
    },
  },
}));

const agentStreamMock = vi.fn(
  async (
    messages: Array<{
      role: "user" | "assistant";
      content: unknown;
    }>,
  ) => {
    const chunks = ["mock", "-", "reply", `(msgs=${messages.length})`];
    return {
      textStream: (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })(),
    };
  },
);

vi.mock("@/mastra/agents/persona", () => ({
  personaAgent: { stream: agentStreamMock },
}));

const { chat } = await import("./chat");

function cookieHeader(token: string) {
  return { Cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

beforeEach(() => {
  sessionsByToken.clear();
  sessionIdToToken.clear();
  agentStreamMock.mockClear();
});

describe("POST /chat validation", () => {
  it("returns 400 and does not call the agent when message is empty", async () => {
    const res = await chat.request("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...cookieHeader("11111111-1111-4111-8111-111111111111"),
      },
      body: JSON.stringify({ message: "   " }),
    });

    expect(res.status).toBe(400);
    expect(agentStreamMock).not.toHaveBeenCalled();
  });

  it("returns 400 when message is missing", async () => {
    const res = await chat.request("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...cookieHeader("22222222-2222-4222-8222-222222222222"),
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /chat streaming and persistence", () => {
  it("streams the assistant reply chunk by chunk and persists both messages", async () => {
    const token = "33333333-3333-4333-8333-333333333333";

    const res = await chat.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cookieHeader(token) },
      body: JSON.stringify({ message: "こんにちは" }),
    });

    expect(res.status).toBe(200);
    const fullText = await readAll(res);
    expect(fullText).toBe("mock-reply(msgs=1)");

    // agent.stream に渡された会話には新規ユーザーメッセージのみが含まれる(履歴なし)
    expect(agentStreamMock).toHaveBeenCalledWith([
      { role: "user", content: "こんにちは" },
    ]);

    const saved = sessionsByToken.get(token)?.messages ?? [];
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ role: "user", content: "こんにちは" });
    expect(saved[1]).toMatchObject({
      role: "assistant",
      content: "mock-reply(msgs=1)",
    });
    // user メッセージの方が先に作成されている(会話順の保持)
    expect(saved[0].createdAt.getTime()).toBeLessThanOrEqual(
      saved[1].createdAt.getTime(),
    );
  });

  it("passes prior conversation history to the agent on the next turn", async () => {
    const token = "44444444-4444-4444-8444-444444444444";

    await readAll(
      await chat.request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cookieHeader(token) },
        body: JSON.stringify({ message: "一通目" }),
      }),
    );

    await readAll(
      await chat.request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cookieHeader(token) },
        body: JSON.stringify({ message: "二通目" }),
      }),
    );

    // 2回目の呼び出しでは、1回目のuser/assistantの履歴 + 新規メッセージの計3件が渡る
    expect(agentStreamMock).toHaveBeenLastCalledWith([
      { role: "user", content: "一通目" },
      { role: "assistant", content: "mock-reply(msgs=1)" },
      { role: "user", content: "二通目" },
    ]);
  });
});

describe("session isolation", () => {
  it("does not leak messages between different session cookies", async () => {
    const tokenA = "55555555-5555-4555-8555-555555555555";
    const tokenB = "66666666-6666-4666-8666-666666666666";

    await readAll(
      await chat.request("/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...cookieHeader(tokenA),
        },
        body: JSON.stringify({ message: "Aさんのメッセージ" }),
      }),
    );

    // セッションBは初回アクセスなので履歴は空
    const messagesResB = await chat.request("/messages", {
      headers: cookieHeader(tokenB),
    });
    const bodyB = await messagesResB.json();
    expect(bodyB.messages).toEqual([]);

    await readAll(
      await chat.request("/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...cookieHeader(tokenB),
        },
        body: JSON.stringify({ message: "Bさんのメッセージ" }),
      }),
    );

    // セッションBのagent呼び出しにAの履歴が混ざっていない(新規メッセージ1件のみ)
    expect(agentStreamMock).toHaveBeenLastCalledWith([
      { role: "user", content: "Bさんのメッセージ" },
    ]);

    const messagesResA = await chat.request("/messages", {
      headers: cookieHeader(tokenA),
    });
    const bodyA = await messagesResA.json();
    expect(bodyA.messages).toHaveLength(2);
    expect(bodyA.messages[0].content).toBe("Aさんのメッセージ");
  });
});

describe("POST /chat image attachments", () => {
  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  it("returns 400 when image has an unsupported media type", async () => {
    const res = await chat.request("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...cookieHeader("77777777-7777-4777-8777-777777777777"),
      },
      body: JSON.stringify({
        message: "この画像なに?",
        image: { data: tinyPngBase64, mediaType: "image/svg+xml" },
      }),
    });

    expect(res.status).toBe(400);
    expect(agentStreamMock).not.toHaveBeenCalled();
  });

  it("returns 400 when both message and image are empty", async () => {
    const res = await chat.request("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...cookieHeader("88888888-8888-4888-8888-888888888888"),
      },
      body: JSON.stringify({ message: "   " }),
    });

    expect(res.status).toBe(400);
    expect(agentStreamMock).not.toHaveBeenCalled();
  });

  it("accepts an image-only message (no text)", async () => {
    const token = "99999999-9999-4999-8999-999999999999";

    const res = await chat.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cookieHeader(token) },
      body: JSON.stringify({
        message: "",
        image: { data: tinyPngBase64, mediaType: "image/png" },
      }),
    });

    expect(res.status).toBe(200);
    await readAll(res);

    expect(agentStreamMock).toHaveBeenCalledWith([
      {
        role: "user",
        content: [
          { type: "image", image: `data:image/png;base64,${tinyPngBase64}` },
        ],
      },
    ]);

    const saved = sessionsByToken.get(token)?.messages ?? [];
    expect(saved[0]).toMatchObject({
      role: "user",
      content: "",
      imageData: tinyPngBase64,
      imageMediaType: "image/png",
    });
  });

  it("passes text+image as content parts and replays the image in later history", async () => {
    const token = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    await readAll(
      await chat.request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cookieHeader(token) },
        body: JSON.stringify({
          message: "これ何かわかる?",
          image: { data: tinyPngBase64, mediaType: "image/png" },
        }),
      }),
    );

    await readAll(
      await chat.request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cookieHeader(token) },
        body: JSON.stringify({ message: "ありがとう" }),
      }),
    );

    // 2回目の呼び出しでは、1回目の画像付きメッセージが履歴としてそのまま渡る
    expect(agentStreamMock).toHaveBeenLastCalledWith([
      {
        role: "user",
        content: [
          { type: "text", text: "これ何かわかる?" },
          { type: "image", image: `data:image/png;base64,${tinyPngBase64}` },
        ],
      },
      { role: "assistant", content: "mock-reply(msgs=1)" },
      { role: "user", content: "ありがとう" },
    ]);
  });

  it("exposes the saved image via GET /messages", async () => {
    const token = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    await readAll(
      await chat.request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cookieHeader(token) },
        body: JSON.stringify({
          message: "見て",
          image: { data: tinyPngBase64, mediaType: "image/png" },
        }),
      }),
    );

    const res = await chat.request("/messages", { headers: cookieHeader(token) });
    const body = await res.json();

    expect(body.messages[0]).toMatchObject({
      role: "user",
      content: "見て",
      image: { data: tinyPngBase64, mediaType: "image/png" },
    });
    expect(body.messages[1].image).toBeNull();
  });
});
