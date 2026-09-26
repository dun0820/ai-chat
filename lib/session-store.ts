import "server-only";
import { prisma } from "@/lib/prisma";

export async function getOrCreateSession(sessionId: string) {
  return prisma.session.upsert({
    where: { token: sessionId },
    create: { token: sessionId },
    update: {},
  });
}

export async function getSessionMessages(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { token: sessionId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  return session?.messages ?? [];
}
