import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const url = env.VITE_SUPABASE_URL?.trim(),
    key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (
    (url || key) &&
    (!url ||
      !/^https:\/\/[a-z0-9.-]+$/.test(url) ||
      !key?.startsWith("sb_publishable_"))
  ) {
    throw new Error(
      "Supabase 配置无效：请同时填写 HTTPS Project URL（末尾不加斜杠）和 sb_publishable_ Publishable Key。禁止使用 Secret / Service Role Key。",
    );
  }
  return {
    base: "./",
    plugins: [react()],
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  };
});
