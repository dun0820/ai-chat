import "dotenv/config";
import { personaAgent } from "./agents/persona";

async function main() {
  const stream = await personaAgent.stream("こんにちは、はじめまして。");

  process.stdout.write("[stream] ");
  for await (const chunk of stream.textStream) {
    process.stdout.write(chunk);
  }
  process.stdout.write("\n");

  console.log("[finishReason]", await stream.finishReason);
  console.log("[usage]", await stream.usage);
}

main().catch((error) => {
  console.error("Agent check failed:", error);
  process.exit(1);
});
