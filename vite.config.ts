import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split heavy third-party libs into named vendor chunks.
        // Browsers cache these separately — only re-downloading what changed.
        manualChunks: {
          "vendor-react":    ["react", "react-dom", "react-router-dom"],
          "vendor-query":    ["@tanstack/react-query"],
          "vendor-ethers":   ["ethers"],
          "vendor-supabase": ["@supabase/supabase-js"],
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
});
