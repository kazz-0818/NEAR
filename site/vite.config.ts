import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** GitHub Pages（/NEAR/）のときだけ base を変える。Vercel / Cloudflare は `/` のまま */
const base = process.env.GITHUB_PAGES === "true" ? "/NEAR/" : "/";

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
});
