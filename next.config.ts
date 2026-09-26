import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Runへのコンテナデプロイ向けに、必要最小限のファイルだけをまとめた
  // .next/standalone を生成する(Dockerfileのrunnerステージで使用)
  output: "standalone",
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
