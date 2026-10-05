import { defineConfig } from 'vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const ROOT = resolve(__dirname, '../..')
const SRC_ROOT = resolve(__dirname, '..')
const DIST = resolve(ROOT, 'dist')
const STELLAR_SDK = resolve(ROOT, 'node_modules/@stellar/stellar-sdk')

// The private payments SDK takes its stellar-base, and so its ExtData encoding, from the copy this
// stellar-sdk build bundles. The build runs only on the exact version package.json pins, and a new
// one must first pass the SDK's vault-fixtures test with stellar-base mapped to its browser build.
const manifest = (dir: string) =>
  JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as {
    version: string
    dependencies?: Record<string, string>
  }
const pinned = manifest(ROOT).dependencies?.['@stellar/stellar-sdk']
const installed = manifest(STELLAR_SDK).version
if (installed !== pinned) {
  throw new Error(`@stellar/stellar-sdk ${installed} is installed, but package.json pins ${pinned}`)
}

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
      { find: /^@stellar\/stellar-base$/, replacement: STELLAR_SDK },
    ],
  },
})
