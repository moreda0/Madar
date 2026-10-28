import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// base './' so the build runs from any folder or sub-path.
// `npm run build:preview` makes one self-contained HTML file (used for the shareable preview).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'preview' ? [viteSingleFile()] : [])],
  build: mode === 'preview' ? { outDir: 'dist-preview', copyPublicDir: false } : {},
}))
