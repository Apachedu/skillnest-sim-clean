// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ai-feedback": {
        target: "https://ai-feedback-874264746569.us-central1.run.app",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/ai-feedback/, "/"),
      },
    },
  },
});
