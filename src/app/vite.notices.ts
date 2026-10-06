import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { dirname, join, relative, resolve, sep } from 'path'
import type { Plugin } from 'vite'

const ROOT = resolve(__dirname, '../..')
const LISTS = resolve(__dirname, '.tmp/shipped')
const NOTICES = 'THIRD-PARTY-NOTICES.txt'

// Packages whose bundled file is a pre-built bundle that inlines its dependencies and ships no
// source map naming them, so each is listed with everything it depends on.
const PREBUILT = ['@stellar/stellar-sdk', 'snarkjs', 'ffjavascript']

// Third-party files this repository carries itself.
const VENDORED: {
  files: string[]
  title: string
  text: () => string
}[] = [
  {
    files: ['src/app/src/assets/fonts/GeistPixel-Square.woff2'],
    title: 'Geist Pixel font, OFL-1.1, https://github.com/vercel/geist-font',
    text: () => readFileSync(resolve(ROOT, 'src/app/src/assets/fonts/GeistPixel-OFL.txt'), 'utf8'),
  },
  {
    files: [
      'src/app/public/circuits/testnet/transaction.wasm',
      'src/app/public/circuits/testnet/transaction.zkey',
      'src/app/public/circuits/testnet/verification_key.json',
    ],
    title:
      'Cyphras private payments circuit, testnet build, GPL-3.0, https://github.com/cyphras/cyphras-contracts/tree/testnet-artifacts-v2/circuits',
    text: () =>
      [
        'circuits/testnet/ holds the witness generator, proving key and verification key built from',
        'this circuit. The circuit includes templates from circomlib 2.0.5',
        '(https://github.com/iden3/circomlib), Copyright 2018 0KIMS association, licensed GPL-3.0.',
        '',
        GPL_REFERENCE,
      ].join('\n'),
  },
]

const GPL_REFERENCE =
  'The GNU General Public License version 3 is reproduced at the end of this file.'

const HEADER = `Third-party notices for the Cyphras browser extension

The Cyphras source code is licensed under the Apache License 2.0 (LICENSE in the repository).
The built extension also includes the third-party software listed below, each under its own
license. Parts of it are licensed under the GNU General Public License version 3: snarkjs,
@cyphras/private-prover-snarkjs, the circuit files and the other entries marked GPL-3.0. The
extension as distributed is therefore conveyed under GPL-3.0, whose full text ends this file. Its
complete corresponding source is https://github.com/cyphras/cyphras-extension at the tag of the
release.

The build writes this file from the modules and files it ships. @stellar/stellar-sdk, snarkjs and
ffjavascript ship pre-built bundles that include their dependencies without naming them, so every
dependency they install is listed, including some their bundles leave out.`

const rel = (file: string) => relative(ROOT, file).split(sep).join('/')

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else yield path
  }
}

// The directory of the installed package `name` as Node resolves it from `from`, or null.
function packageDir(name: string, from: string): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (dir === ROOT || dirname(dir) === dir) return null
  }
}

function nameOf(specifier: string): string {
  const parts = specifier.split('/')
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
}

// The package a file under node_modules belongs to, by its innermost node_modules folder.
function packageOf(file: string): { name: string; dir: string } | null {
  const marker = `${sep}node_modules${sep}`
  const at = file.lastIndexOf(marker)
  if (at < 0) return null
  const name = nameOf(
    file
      .slice(at + marker.length)
      .split(sep)
      .join('/')
  )
  return { name, dir: join(file.slice(0, at + marker.length), name) }
}

// Tailwind inlines the stylesheets a bundled one imports, so they never show up as modules.
function cssImports(file: string): string[] {
  const found: string[] = []
  for (const [, spec] of readFileSync(file, 'utf8').matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
    if (/^[./]/.test(spec)) continue
    const dir = packageDir(nameOf(spec), dirname(file))
    if (!dir) throw new Error(`${rel(file)} imports ${spec}, which is not installed`)
    found.push(join(dir, 'package.json'))
  }
  return found
}

// Records every file a build ships: modules that render code, stylesheet imports, emitted assets
// and the public folder. Virtual modules are recorded as the package that provides them.
export function recordShipped(build: string): Plugin {
  let root = ROOT
  let publicDir = ''
  return {
    name: 'record-shipped',
    apply: 'build',
    configResolved(config) {
      root = config.root
      publicDir = config.publicDir
    },
    generateBundle(_, bundle) {
      const files = new Set<string>()
      for (const out of Object.values(bundle)) {
        if (out.type === 'asset') {
          for (const f of out.originalFileNames) files.add(resolve(root, f))
          continue
        }
        for (const [id, m] of Object.entries(out.modules)) {
          if (id.startsWith('\0')) {
            const dir = packageDir(nameOf(id.slice(1)), ROOT)
            if (!dir) throw new Error(`no package provides the virtual module ${id.slice(1)}`)
            files.add(join(dir, 'package.json'))
            continue
          }
          const file = id.split('?')[0]
          if (file.endsWith('.css')) {
            files.add(file)
            for (const f of cssImports(file)) files.add(f)
          } else if (m.renderedLength > 0) files.add(file)
        }
      }
      if (publicDir && existsSync(publicDir)) for (const f of walk(publicDir)) files.add(f)
      mkdirSync(LISTS, { recursive: true })
      writeFileSync(join(LISTS, `${build}.json`), JSON.stringify([...files].map(rel).sort()))
    },
  }
}

interface Meta {
  name: string
  version: string
  license?: string | { type: string }
  licenses?: { type: string }[]
  repository?: string | { url: string }
  homepage?: string
  dependencies?: Record<string, string>
}

const readMeta = (dir: string) =>
  JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Meta

function licenseOf(meta: Meta): string {
  if (typeof meta.license === 'string') return meta.license
  if (meta.license) return meta.license.type
  if (meta.licenses) return meta.licenses.map((l) => l.type).join(' OR ')
  return 'no license declared'
}

function sourceOf(meta: Meta): string | undefined {
  const repo = typeof meta.repository === 'string' ? meta.repository : meta.repository?.url
  const url = (repo ?? meta.homepage)?.replace(/^git\+/, '').replace(/\.git$/, '')
  if (!url) return undefined
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`
  return url
    .replace(/^https?:(?=https?:\/\/)/, '')
    .replace(/^(git|ssh):\/\/(git@)?/, 'https://')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^github:/, 'https://github.com/')
}

const tidy = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/^\n+|\n+$/g, '')

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

// Copies of the GPL-3.0 text differ in small ways, such as the FSF's address or http and https.
const isGpl3 = (text: string) =>
  text.length > 30000 &&
  squash(text).startsWith('GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007')

// A GPL-3.0 text becomes a reference to the copy at the end, keeping any copyright line a package
// put in place of the FSF's.
function gplNotice(text: string): string {
  const own = text
    .split('\n')
    .filter((l) => /Copyright \(C\)/.test(l) && !/Free Software Foundation|[<{]year[>}]/.test(l))
  return [...own.map((l) => l.trim()), GPL_REFERENCE].join('\n')
}

// A package's license and notice files, as one text. A license file that goes on to list the
// licenses of the package's own bundled dependencies, as vite's does, is cut there: those are its
// build tools, and none of them ship here.
function noticeOf(dir: string, meta: Meta): string {
  const files = readdirSync(dir).sort()
  const texts = files
    .filter((f) => /^(licen[cs]e|copying)([._-]|$)/i.test(f))
    .map((f) =>
      tidy(readFileSync(join(dir, f), 'utf8').split(/\n# Licenses of bundled dependencies\n/)[0])
    )
    .map((t) => (isGpl3(t) ? gplNotice(t) : t))
  if (texts.length === 0) {
    const declared = licenseOf(meta)
    texts.push(`The package ships no license file; its package.json declares ${declared}.`)
    if (declared.startsWith('GPL-3.0')) texts.push(GPL_REFERENCE)
  }
  for (const f of files.filter((f) => /^notice([._-]|$)/i.test(f))) {
    texts.push(tidy(readFileSync(join(dir, f), 'utf8')))
  }
  return texts.join('\n\n')
}

// Writes the notices for the builds' recorded files to the repository root and into dist.
export function writeNotices(builds: string[], dist: string): void {
  const shipped = new Set<string>()
  for (const build of builds) {
    const list = JSON.parse(readFileSync(join(LISTS, `${build}.json`), 'utf8')) as string[]
    for (const f of list) shipped.add(f)
  }

  const dirs = new Set<string>()
  const bundleNotes = new Map<string, string>()
  for (const f of shipped) {
    const file = resolve(ROOT, f)
    const pkg = packageOf(file)
    if (!pkg) continue
    dirs.add(pkg.dir)
    // A bundle's source map names the packages it was built from.
    if (existsSync(`${file}.map`)) {
      const map = JSON.parse(readFileSync(`${file}.map`, 'utf8')) as { sources: string[] }
      for (const source of map.sources) {
        if (!source.includes('node_modules/')) continue
        const inner = packageOf(resolve(dirname(file), source.split('/').join(sep)))
        if (!inner) continue
        const installed = packageDir(inner.name, pkg.dir)
        if (!installed) throw new Error(`${f} was built from ${inner.name}, which is not installed`)
        dirs.add(installed)
      }
    }
    // The license comments a minifier kept aside for a bundle.
    if (existsSync(`${file}.LICENSE.txt`)) {
      bundleNotes.set(pkg.dir, tidy(readFileSync(`${file}.LICENSE.txt`, 'utf8')))
    }
  }

  for (const dir of [...dirs]) {
    if (!PREBUILT.includes(readMeta(dir).name)) continue
    const queue = [dir]
    while (queue.length > 0) {
      const at = queue.pop() as string
      for (const dep of Object.keys(readMeta(at).dependencies ?? {})) {
        const found = packageDir(dep, at)
        if (found && !dirs.has(found)) {
          dirs.add(found)
          queue.push(found)
        }
      }
    }
  }

  // The same name and version installed in several places is listed once.
  const byKey = new Map<string, { dir: string; meta: Meta }>()
  for (const dir of [...dirs].sort()) {
    const meta = readMeta(dir)
    const key = `${meta.name}@${meta.version}`
    if (!byKey.has(key)) byKey.set(key, { dir, meta })
  }

  const groups = new Map<string, string[]>()
  const add = (text: string, line: string) => groups.set(text, [...(groups.get(text) ?? []), line])
  for (const key of [...byKey.keys()].sort()) {
    const { dir, meta } = byKey.get(key) as { dir: string; meta: Meta }
    const source = sourceOf(meta)
    const notes = bundleNotes.get(dir)
    const kept = notes ? `\n\nLicense comments kept from its bundle:\n\n${notes}` : ''
    add(
      noticeOf(dir, meta) + kept,
      `${meta.name} ${meta.version}, ${licenseOf(meta)}${source ? `, ${source}` : ''}`
    )
  }
  for (const v of VENDORED) {
    if (v.files.some((f) => shipped.has(f))) add(tidy(v.text()), v.title)
  }

  // The prover ships the GPL-3.0 text as the FSF publishes it.
  const prover = [...byKey.values()].find((p) => p.meta.name === '@cyphras/private-prover-snarkjs')
  if (!prover) throw new Error('the prover is not bundled, so the GPL-3.0 text has no source')
  const gpl = tidy(readFileSync(join(prover.dir, 'LICENSE'), 'utf8'))

  const rule = '-'.repeat(79)
  const sections = [...groups.entries()].map(
    ([text, lines]) => `${rule}\n${lines.join('\n')}\n\n${text}`
  )
  const out = `${HEADER}\n\n${sections.join('\n\n')}\n\n${rule}\nGNU General Public License version 3\n\n${gpl}\n`

  const target = resolve(ROOT, NOTICES)
  if (!existsSync(target) || readFileSync(target, 'utf8') !== out) writeFileSync(target, out)
  copyFileSync(target, join(dist, NOTICES))
}
