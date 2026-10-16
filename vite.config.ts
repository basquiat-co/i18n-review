import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Un seul fichier HTML en sortie (JS, CSS et polices inclus) : publié tel quel sur GitHub Pages,
// et utilisable aussi en ouvrant le fichier téléchargé directement dans le navigateur.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
