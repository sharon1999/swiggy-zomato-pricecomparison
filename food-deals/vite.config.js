import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The React app lives in web/. `npm run build` writes it to dist/, which the
// Express server serves. In dev, Vite serves the UI on :5173 and forwards
// API calls to Express on :3000.
export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/callback": "http://localhost:3000",
    },
  },
});
