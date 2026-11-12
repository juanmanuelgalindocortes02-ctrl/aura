import { defineConfig } from "vite";
import { resolve } from "node:path";

// Tauri espera el servidor de desarrollo en un puerto fijo.
// Hay dos páginas: la ventana principal y la isla dinámica.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        isla: resolve(__dirname, "isla.html"),
      },
    },
  },
});
