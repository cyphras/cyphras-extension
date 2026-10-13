// Every private request handler takes its network and its account from what the request names,
// checked against the active ones, and never from the active ones alone. The handlers are read
// from the source, since the background's entry module only loads in the browser.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { SERVICE_TYPES } from '../src/constants/services.ts'

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const index = source('../src/background/index.ts')
const wallet = source('../src/background/shielded/wallet.ts')

const PRIVATE_TYPES = Object.keys(SERVICE_TYPES).filter((type) => type.startsWith('SHIELDED_'))

// The handler of each case of the service switch, from its labels to the next case.
function handlers() {
  const blocks = []
  let block = null
  for (const line of index.split('\n')) {
    const label = /^ {4}case SERVICE_TYPES\.(\w+):/.exec(line)
    if (label) {
      if (block?.body === '') block.types.push(label[1])
      else blocks.push((block = { types: [label[1]], body: '' }))
    } else if (/^ {4}(case |default:)|^ {2}\}/.test(line)) {
      block = null
    } else if (block) {
      block.body += `${line}\n`
    }
  }
  return blocks
}

const privateHandlers = handlers().filter((h) => h.types.some((t) => PRIVATE_TYPES.includes(t)))

// The wallet operations index.ts imports, and each call of one in a handler with its arguments.
const OPERATIONS = /import \{([^}]*)\} from '\.\/shielded\/wallet'/
  .exec(index)[1]
  .split(',')
  .map((name) => name.trim())
  .filter((name) => /^shielded[A-Z]/.test(name))

function operationCalls(body) {
  const calls = []
  for (const match of body.matchAll(new RegExp(`\\b(${OPERATIONS.join('|')})\\(`, 'g'))) {
    const start = match.index + match[0].length
    let depth = 1
    let end = start
    for (; depth > 0; end++) {
      if (body[end] === '(') depth++
      if (body[end] === ')') depth--
    }
    calls.push({ name: match[1], args: body.slice(start, end - 1), at: match.index })
  }
  return calls
}

test('every private message type has a handler', () => {
  for (const type of PRIVATE_TYPES) {
    assert.equal(privateHandlers.filter((h) => h.types.includes(type)).length, 1, type)
  }
})

test('every private handler checks the network the request names before it acts', () => {
  for (const { types, body } of privateHandlers) {
    const check = body.indexOf('getShieldedNetwork(message.networkId)')
    assert.notEqual(check, -1, `${types} takes no network from the request`)
    assert.doesNotMatch(body, /\bgetActiveNetwork\(|\bgetNetworks\(/, `${types}`)
    for (const call of operationCalls(body)) assert.ok(check < call.at, `${types}: ${call.name}`)
  }
})

test('every private handler hands the wallet the account the request names', () => {
  for (const { types, body } of privateHandlers) {
    const calls = operationCalls(body)
    assert.ok(calls.length > 0, `${types} calls no wallet operation`)
    for (const call of calls)
      assert.match(call.args, /\bmessage\.publicKey\b/, `${types}: ${call.name}`)
    assert.doesNotMatch(
      body,
      /\bgetAccountsStore\(|\bgetSessionPublicKey\(|\bSESSION_KEY\b/,
      `${types}`
    )
  }
})

test('every wallet operation checks that account where it reads the active one', () => {
  for (const name of OPERATIONS) {
    const start = wallet.indexOf(`export async function ${name}(`)
    assert.notEqual(start, -1, `${name} is not an async export of the wallet`)
    const end = wallet.indexOf('\nexport ', start + 1)
    const body = wallet.slice(start, end === -1 ? undefined : end)
    assert.match(body, /\bpublicKey: unknown\b/, name)
    assert.match(body, /\bwalletFor\(net, publicKey\b|\bactiveAccount\(publicKey\)/, name)
  }
  assert.match(wallet, /account\.publicKey !== publicKey[\s\S]{0,80}'account_changed'/)
})
