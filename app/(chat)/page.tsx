"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // マウント時にセッションの会話履歴を取得
  useEffect(() => {
    let ignore = false;

    (async () => {
      try {
        const res = await fetch("/api/messages");
        const data: {
          messages?: { role: "user" | "assistant"; content: string }[];
        } = await res.json();
        if (!ignore) {
          setMessages(
            (data.messages ?? []).map((m) => ({
              role: m.role,
              content: m.content,
            })),
          );
        }
      } catch (error) {
        console.error("Failed to load chat history:", error);
      } finally {
        if (!ignore) setIsHistoryLoading(false);
      }
    })();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isSending) return;

    setInput("");
    setIsSending(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + chunk };
          return next;
        });
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: "(エラーが発生しました。しばらくしてから再度お試しください)",
        };
        return next;
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col bg-white px-4 dark:bg-black">
      <header className="border-b border-black/[.08] py-4 dark:border-white/[.145]">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          凪とおしゃべり
        </h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {isHistoryLoading ? (
          <p className="text-sm text-zinc-400">読み込み中…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-zinc-400">
            メッセージを送って会話を始めましょう。
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                }`}
              >
                {m.content ||
                  (isSending && i === messages.length - 1 ? "…" : "")}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex gap-2 border-t border-black/[.08] py-3 dark:border-white/[.145]"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="メッセージを入力…"
          disabled={isSending}
          className="flex-1 rounded-full border border-black/[.12] bg-transparent px-4 py-2 text-sm text-zinc-900 outline-none focus:border-blue-500 disabled:opacity-50 dark:border-white/[.16] dark:text-zinc-50"
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          送信
        </button>
      </form>
    </div>
  );
}
