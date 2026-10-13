// Lets a test import the extension's sources as the bundler resolves them: the path aliases, and
// relative imports written without the .ts extension.
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const SRC = new URL('../../src/', import.meta.url)
const ALIASES = { '@constants/': 'constants/', '@ext-types/': 'types/' }

// sdk, when given, is the URL of a module that stands in for @cyphras/private everywhere but in
// itself, so it can build on the real one.
export function resolveSources({ sdk } = {}) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (sdk && specifier === '@cyphras/private' && context.parentURL !== sdk) {
        return { url: sdk, shortCircuit: true }
      }
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
