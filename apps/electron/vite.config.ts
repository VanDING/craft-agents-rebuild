import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { reactPdfAlias } from '../../scripts/build/react-pdf-alias'

// NOTE: Source map upload to Sentry is intentionally disabled.
// To re-enable, uncomment the sentryVitePlugin below and add SENTRY_AUTH_TOKEN,
// SENTRY_ORG, SENTRY_PROJECT to CI secrets. See CLAUDE.md "Sentry Error Tracking" section.
// import { sentryVitePlugin } from '@sentry/vite-plugin'

export default defineConfig({
  plugins: [
    react(),
    babel({
      plugins: [
        // Jotai HMR support: caches atom instances in globalThis.jotaiAtomCache
        // so that HMR module re-execution returns stable atom references
        // instead of creating new (empty) atoms that orphan existing data.
        'jotai/babel/plugin-debug-label',
        ['jotai/babel/plugin-react-refresh', { customAtomNames: ['atomFamily'] }],
      ],
    }),
    tailwindcss(),
    // Production CSP hardening: the dev server needs localhost:8097 and inline
    // script allowances for React DevTools; packaged renderer pages do not.
    {
      name: 'craft-production-csp',
      transformIndexHtml: {
        order: 'pre' as const,
        handler(html: string, ctx: { server?: unknown }) {
          if (ctx.server) return html
          return html
            .replace(/\n?\s*<script src="\.\/react-devtools\.js"><\/script>/, '')
            .replace(
              /(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/,
              '$1' + "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https: file: thumbnail: blob:; connect-src 'self' https: http://localhost:* ws://localhost:* wss://localhost:* http://127.0.0.1:* ws://127.0.0.1:* wss://127.0.0.1:* wss:; font-src 'self' data: https://fonts.gstatic.com; worker-src 'self' blob:; object-src 'self' file:;" + '$2',
            )
        },
      },
    },
    // Sentry source map upload — intentionally disabled. See CLAUDE.md for re-enabling instructions.
    // sentryVitePlugin({
    //   org: process.env.SENTRY_ORG,
    //   project: process.env.SENTRY_PROJECT,
    //   authToken: process.env.SENTRY_AUTH_TOKEN,
    //   disable: !process.env.SENTRY_AUTH_TOKEN,
    //   sourcemaps: {
    //     filesToDeleteAfterUpload: ['**/*.map'],
    //   },
    // }),
  ],
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,  // Source maps generated for debugging. Not uploaded to Sentry (see CLAUDE.md).
    rolldownOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        playground: resolve(__dirname, 'src/renderer/playground.html'),
        'browser-toolbar': resolve(__dirname, 'src/renderer/browser-toolbar.html'),
        'browser-empty-state': resolve(__dirname, 'src/renderer/browser-empty-state.html'),
      }
    }
  },
  resolve: {
    alias: {
      ...reactPdfAlias(import.meta.url),
      '@': resolve(__dirname, 'src/renderer'),
      '@config': resolve(__dirname, '../../packages/shared/src/config'),
      // Force all React imports to use the root node_modules React
      // Bun hoists deps to root. This prevents "multiple React copies" error from @craft-agent/ui
      'react': resolve(__dirname, '../../node_modules/react'),
      'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
      // rehype-katex 7 declares katex ^0.16 but only calls the stable
      // renderToString API; resolve both copies to the single current katex to
      // avoid shipping two ~240 KB copies in the initial renderer graph.
      'katex': resolve(__dirname, '../../node_modules/katex'),
    },
    dedupe: ['react', 'react-dom', 'katex']
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'jotai', 'pdfjs-dist'],
    exclude: ['@craft-agent/ui'],
  },
  server: {
    port: 5173,
    open: false
  }
})
