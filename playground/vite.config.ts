import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: [
      "@babel/runtime/helpers/extends",
      "@babel/runtime/helpers/objectWithoutPropertiesLoose",
      "@babel/runtime/helpers/objectDestructuringEmpty",
      "@tanstack/react-table",
    ],
  },
  build: {
    rollupOptions: {
      external: [],
    },
    commonjsOptions: {
      include: [/node_modules/],
    },
  },
});
