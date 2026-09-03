/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules\/(?:react|react-dom|scheduler)\//, minSize: 0 },
            { name: 'vendor-codemirror', test: /node_modules\/(?:@codemirror|@uiw\/react-codemirror|@lezer|lezer|crelt|style-mod|w3c-keyname)\//, minSize: 0 },
            { name: 'vendor-ui', test: /node_modules\/(?:@radix-ui|class-variance-authority|tailwind-merge|clsx)\//, minSize: 0 },
            { name: 'vendor-table', test: /node_modules\/(?:@tanstack|date-fns|react-day-picker)\//, minSize: 0 },
            { name: 'vendor-app', test: /node_modules\/(?:react-router|react-i18next|i18next|lucide-react|sql-formatter|fflate)\//, minSize: 0 },
            { name: 'vendor-tauri', test: /node_modules\/@tauri-apps\//, minSize: 0 },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
  },
})
