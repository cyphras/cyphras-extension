// Lets a test import the extension's sources as the bundler resolves them: the path aliases, and
// relative imports written without the .ts extension.
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const SRC = new URL('../../src/', import.meta.url)
const ALIASES = { '@constants/': 'constants/', '@ext-types/': 'types/' }

export function resolveSources() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      for (const [alias, dir] of Object.entries(ALIASES)) {
        if (specifier.startsWith(alias)) {
          specifier = new URL(dir + specifier.slice(alias.length), SRC).href
        }
      }
      if (/^(\.|file:)/.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
        const url = new URL(`${specifier}.ts`, context.parentURL)
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true }
      }
      return nextResolve(specifier, context)
    },
  })
}
