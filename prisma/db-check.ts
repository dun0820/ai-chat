import { prisma } from "../lib/prisma";

async function main() {
  const session = await prisma.session.create({
    data: { token: crypto.randomUUID() },
  });
  console.log("[create] session:", session.id);

  const message = await prisma.message.create({
    data: {
      sessionId: session.id,
      role: "user",
      content: "db-check: hello",
    },
  });
  console.log("[create] message:", message.id);

  const found = await prisma.session.findUnique({
    where: { id: session.id },
    include: { messages: true },
  });
  console.log("[read] session with messages:", found);

  await prisma.message.delete({ where: { id: message.id } });
  await prisma.session.delete({ where: { id: session.id } });
  console.log("[delete] cleaned up session and message");

  console.log("DB check OK");
}

main()
  .catch((error) => {
    console.error("DB check failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
