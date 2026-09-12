import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { reactPdfAlias } from '../../scripts/build/react-pdf-alias'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: __dirname,
  // Base path for production - assets go to /s/assets/* to avoid conflict with marketing site
  base: '/s/',
  resolve: {
    alias: {
      ...reactPdfAlias(import.meta.url),
      '@': resolve(__dirname, './src'),
      // Ensure all React imports resolve to the hoisted root node_modules
      'react': resolve(__dirname, '../../node_modules/react'),
      'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
      // rehype-katex 7 declares katex ^0.16 but only calls the stable
      // renderToString API; resolve both copies to the single current katex to
      // avoid shipping two ~240 KB copies in the initial renderer graph.
      'katex': resolve(__dirname, '../../node_modules/katex'),
    },
    dedupe: ['react', 'react-dom', 'katex'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
  server: {
    port: 5174, // Different from Electron dev server
    open: true,
    proxy: {
      // Proxy API requests to production R2 during local dev
      '/s/api': {
        target: 'https://thecraftagents.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
