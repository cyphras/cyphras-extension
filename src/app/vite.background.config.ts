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
      globals: {
        Buffer: true,
      },
    }),
  ],
  build: {
    outDir: DIST,
    emptyOutDir: false,
    lib: {
      entry: resolve(SRC_ROOT, 'background/index.ts'),
      name: 'background',
      fileName: () => 'background.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
  resolve: {
    alias: [
      { find: '@constants', replacement: resolve(SRC_ROOT, 'constants') },
      { find: '@ext-types', replacement: resolve(SRC_ROOT, 'types') },
      // The browser build of stellar-sdk bundles stellar-base and exports all of it, so the
      // private payments SDK, whose peer dependency it is, takes that copy rather than a second.
      {
        find: /^@stellar\/stellar-base$/,
        replacement: resolve(ROOT, 'node_modules/@stellar/stellar-sdk'),
      },
    ],
  },
})
