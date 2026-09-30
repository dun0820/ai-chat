"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";

type ImageAttachment = { data: string; mediaType: string };

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  image?: ImageAttachment | null;
};

// server/routes/chat.ts の ALLOWED_IMAGE_MEDIA_TYPES / MAX_IMAGE_DATA_LENGTH と揃える
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [pendingImage, setPendingImage] = useState<ImageAttachment | null>(
    null,
  );
  const [imageError, setImageError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // マウント時にセッションの会話履歴を取得
  useEffect(() => {
    let ignore = false;

    (async () => {
      try {
        const res = await fetch("/api/messages");
        const data: {
          messages?: {
            role: "user" | "assistant";
            content: string;
            image?: ImageAttachment | null;
          }[];
        } = await res.json();
        if (!ignore) {
          setMessages(
            (data.messages ?? []).map((m) => ({
              role: m.role,
              content: m.content,
              image: m.image ?? null,
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

  async function attachImageFile(file: File) {
    setImageError(null);

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setImageError("対応していない画像形式です（jpg/png/gif/webpのみ）");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("画像サイズが大きすぎます（5MBまで）");
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      setPendingImage({ data: base64, mediaType: file.type });
    } catch (error) {
      console.error("Failed to read image file:", error);
      setImageError("画像の読み込みに失敗しました");
    }
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) attachImageFile(file);
  }

  function handleDrop(e: DragEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) attachImageFile(file);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if ((!text && !pendingImage) || isSending) return;

    const image = pendingImage;
    setInput("");
    setPendingImage(null);
    setImageError(null);
    setIsSending(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text, image },
      { role: "assistant", content: "" },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, image: image ?? undefined }),
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
                {m.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`data:${m.image.mediaType};base64,${m.image.data}`}
                    alt="添付画像"
                    className="mb-2 max-h-60 max-w-full rounded-lg object-contain"
                  />
                )}
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
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col gap-2 border-t py-3 dark:border-white/[.145] ${
          isDragging
            ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
            : "border-black/[.08]"
        }`}
      >
        {imageError && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {imageError}
          </p>
        )}
        {pendingImage && (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:${pendingImage.mediaType};base64,${pendingImage.data}`}
              alt="添付予定の画像"
              className="h-16 w-16 rounded-lg object-cover"
            />
            <button
              type="button"
              onClick={() => setPendingImage(null)}
              className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              画像を削除
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_IMAGE_TYPES.join(",")}
            onChange={handleFileInputChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending}
            aria-label="画像を添付"
            className="rounded-full border border-black/[.12] px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-white/[.16] dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            📷
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="メッセージを入力…"
            disabled={isSending}
            className="flex-1 rounded-full border border-black/[.12] bg-transparent px-4 py-2 text-sm text-zinc-900 outline-none focus:border-blue-500 disabled:opacity-50 dark:border-white/[.16] dark:text-zinc-50"
          />
          <button
            type="submit"
            disabled={isSending || (!input.trim() && !pendingImage)}
            className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            送信
          </button>
        </div>
      </form>
    </div>
  );
}
