import { defineConfig } from 'vite'
import { resolve } from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const ROOT = resolve(__dirname, '../..')
const SRC_ROOT = resolve(__dirname, '..')
const DIST = resolve(ROOT, 'dist')

export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ['buffer'],
      globals: { Buffer: true },
    }),
  ],
  resolve: {
    alias: {
      '@constants': resolve(SRC_ROOT, 'constants'),
      '@ext-types': resolve(SRC_ROOT, 'types'),
    },
  },
  build: {
    outDir: DIST,
    emptyOutDir: false,
    lib: {
      entry: resolve(SRC_ROOT, 'content/bridge.ts'),
      name: 'bridge',
      formats: ['iife'],
      fileName: () => 'bridge.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
