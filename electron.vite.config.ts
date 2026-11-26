import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// NOTE: vite-plugin-monaco-editor was removed together with base-editor.tsx —
// nothing in the renderer imports Monaco anymore, so emitting its ~10 MB of
// language workers into every build was pure dead weight.

// A fresh BUILD_ID is baked into the compiled main bundle on every `pnpm build`.
// `getAppConfig` compares it against the value persisted in the user's config
// and, when it differs, regenerates the TG WS secret + URL. That guarantees
// every installed build (and every rebuild during dev/QA) gets a unique
// secret instead of inheriting whatever the previous installer wrote.
const BUILD_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __BUILD_ID__: JSON.stringify(BUILD_ID)
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    // Dev server строго на IPv4-loopback: при включённом VPN/kill switch
    // IPv6-loopback (::1) бывает заблокирован, и окно остаётся пустым.
    server: {
      host: '127.0.0.1'
    },
    build: {
      // Сборка для пользователей: минифицированный код без source map (раньше
      // renderer шёл без минификации — 4,3 МБ). Main и preload не сжимаем:
      // выигрыш там мал, а читаемые стеки ошибок в логах важнее.
      minify: 'esbuild',
      sourcemap: false,
      target: 'chrome138',
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [
      react(),
      tailwindcss()
    ]
  }
})
