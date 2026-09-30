import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { resolve } from 'path'
import { copyFileSync } from 'fs'
import { execSync } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const pkg = require('../../package.json') as { version: string }

const ROOT = resolve(__dirname, '../..')
const SRC_ROOT = resolve(__dirname, '..')
const DIST = resolve(ROOT, 'dist')

export default defineConfig({
  root: resolve(__dirname),
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    // snarkjs / circomlibjs in the offscreen prover reference the Node Buffer global.
    nodePolyfills({ include: ['buffer'], globals: { Buffer: true } }),
    tailwindcss(),
    react(),
    {
      name: 'copy-extension-files',
      closeBundle() {
        copyFileSync(resolve(ROOT, 'manifest.json'), resolve(DIST, 'manifest.json'))
        console.log('manifest.json copied to dist/')
        execSync(
          `node --experimental-vm-modules ${resolve(ROOT, 'node_modules/.bin/vite')} build --config ${resolve(__dirname, 'vite.background.config.ts')}`,
          { stdio: 'inherit', cwd: ROOT }
        )
        execSync(
          `node --experimental-vm-modules ${resolve(ROOT, 'node_modules/.bin/vite')} build --config ${resolve(__dirname, 'vite.content.config.ts')}`,
          { stdio: 'inherit', cwd: ROOT }
        )
        execSync(
          `node --experimental-vm-modules ${resolve(ROOT, 'node_modules/.bin/vite')} build --config ${resolve(__dirname, 'vite.bridge.config.ts')}`,
          { stdio: 'inherit', cwd: ROOT }
        )
      },
    },
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@bg': resolve(SRC_ROOT, 'background'),
      '@constants': resolve(SRC_ROOT, 'constants'),
      '@ext-types': resolve(SRC_ROOT, 'types'),
      '@private': resolve(SRC_ROOT, 'private'),
      '@shielded': resolve(SRC_ROOT, 'shielded'),
    },
  },
  build: {
    outDir: DIST,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'wallet.html'),
        approval: resolve(__dirname, 'approval.html'),
        onboarding: resolve(__dirname, 'onboarding.html'),
        offscreen: resolve(__dirname, 'offscreen.html'),
      },
    },
  },
})
