/// <reference types="vitest/config" />
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mockApi } from './mock/plugin.ts'

// Built assets are baked into the Python package so the backend can serve them.
const OUT_DIR = fileURLToPath(new URL('../src/app_benchmark/static', import.meta.url))
const ASSETS_DIR = 'assets'

/**
 * The output dir belongs to the backend package, so instead of emptying it we
 * remove only what this build owns (index.html + the hashed assets dir) and
 * leave anything else the backend keeps there untouched.
 */
function cleanOwnedOutput(): Plugin {
  return {
    name: 'clean-owned-output',
    apply: 'build',
    buildStart() {
      rmSync(`${OUT_DIR}/${ASSETS_DIR}`, { recursive: true, force: true })
      rmSync(`${OUT_DIR}/index.html`, { force: true })
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Set VITE_API_PROXY (e.g. http://localhost:8000) to develop against a real backend;
  // otherwise `npm run dev` and `npm run preview` serve generated mock data.
  const proxyTarget = env.VITE_API_PROXY
  const apiBase = env.VITE_API_BASE || '/api'

  return {
    // Relative asset URLs, so the bundle works wherever the backend mounts it.
    // The API client resolves `api/` relative to the page the same way.
    base: './',
    plugins: [react(), tailwindcss(), cleanOwnedOutput(), command === 'serve' && !proxyTarget && mockApi(apiBase)],
    server: proxyTarget ? { proxy: { [apiBase]: { target: proxyTarget, changeOrigin: true } } } : undefined,
    preview: proxyTarget ? { proxy: { [apiBase]: { target: proxyTarget, changeOrigin: true } } } : undefined,
    build: {
      outDir: OUT_DIR,
      assetsDir: ASSETS_DIR,
      emptyOutDir: false,
    },
    test: {
      include: ['src/**/*.test.{ts,tsx}', 'mock/**/*.test.ts'],
      environment: 'jsdom',
      setupFiles: ['src/test/setup.ts'],
    },
  }
})
