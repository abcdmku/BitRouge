import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = "127.0.0.1";
// GitHub Pages serves from /BitRouge/; everywhere else relative assets work.
const base = process.env.GITHUB_PAGES === "true" ? "/BitRouge/" : "./";

export default defineConfig({
  base,
  plugins: [react()],
  optimizeDeps: {
    include: ["phaser"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { phaser: ["phaser"] },
      },
    },
  },
  server: {
    host,
    port: 6174,
    strictPort: true,
  },
  preview: {
    host,
    port: 4174,
    strictPort: true,
  },
});
