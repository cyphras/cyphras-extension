// Network fees above what the wallet pays without asking, and the errors that stop a payment:
// an approval lifts the caps of one transaction only and never past what one envelope carries, a
// payment that waits on the user is never shown as one that may still land, and no SDK code or
// ledger name reaches the user's text.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveSources } from './support/sources.mjs'

resolveSources()

const { CyphrasError, PINNED_DEPLOYMENTS } = await import('@cyphras/private')
const {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
} = await import('@stellar/stellar-sdk')
const { DEFAULT_FEE_BUDGET, budgetSigner, feeCeiling, grantBudget, grantCaps, MAX_ENVELOPE_FEE } =
  await import('../src/background/shielded/fees.ts')
const { dropGrants, issueGrant, takeGrant } =
  await import('../src/background/shielded/approvals.ts')
const { MayStillLand, errorView } = await import('../src/background/shielded/errors.ts')
const { declineAllReviews, reviewView } = await import('../src/background/shielded/reviews.ts')
const { vaultSigner } = await import('../src/background/shielded/signer.ts')

const fail = (code, details = {}) => new CyphrasError(code, 'sdk text', details)
const XLM = 10_000_000n

test('a ceiling is the fee plus 10%, the resource part rounded up to 0.01 XLM', () => {
  assert.deepEqual(feeCeiling('150', '15000000'), {
    inclusionCap: 100_000n,
    resourceCap: 16_500_000n,
    ceiling: 16_600_000n,
  })
  // 1.1 x 12,345,678 = 13,580,245.8, rounded up to the next 0.01 XLM.
  assert.equal(feeCeiling('100', '12345678').resourceCap, 13_600_000n)
  assert.equal(feeCeiling('200000', '0').inclusionCap, 220_000n)
  assert.equal(feeCeiling('0', '0').ceiling, 100_000n)
})

test('a ceiling stops at what one envelope carries, and none from a malformed fee', () => {
  // 1.1 x this fee is above the envelope limit while the fee itself fits one envelope.
  assert.equal(feeCeiling('100', '3904515000').ceiling, MAX_ENVELOPE_FEE)
  assert.equal(feeCeiling('100', '4294967296'), null)
  for (const [i, r] of [
    ['-1', '5'],
    ['1.5', '5'],
    [5, '5'],
    ['5', undefined],
    ['01', '5'],
  ]) {
    assert.equal(feeCeiling(i, r), null, `${i} ${r}`)
  }
})

test('an approved fee becomes caps for its call, a restore above 1 XLM in the restore room', () => {
  assert.deepEqual(grantCaps('network', 100_000n, 16_600_000n), {
    inclusion: 100_000n,
    resource: 16_500_000n,
    restore: 0n,
  })
  assert.deepEqual(grantCaps('rent', 100_000n, 5_100_000n), {
    inclusion: 100_000n,
    resource: 5_000_000n,
    restore: 0n,
  })
  assert.deepEqual(grantCaps('restore', 100_000n, 70_100_000n), {
    inclusion: 100_000n,
    resource: XLM,
    restore: 60_000_000n,
  })
})

test('the most a call may pay adds the default room after a restore that precedes the call', () => {
  assert.equal(grantBudget('network', 16_600_000n, false), 16_600_000n)
  assert.equal(grantBudget('restore', 70_100_000n, false), 70_100_000n + DEFAULT_FEE_BUDGET)
  assert.equal(grantBudget('restore', 70_100_000n, true), 70_100_000n)
})

const scope = { account: 'GACCOUNT', network: 'testnet' }
const grant = (fields = {}) => ({
  call: 'retry',
  target: 'p1',
  ...scope,
  caps: undefined,
  budget: DEFAULT_FEE_BUDGET,
  warnings: [],
  ...fields,
})

test('an offer is taken once, for its call, target, account and network only', () => {
  const id = issueGrant(grant())
  assert.equal(takeGrant(id, 'retry', 'p1', 'GACCOUNT', 'testnet').target, 'p1')
  assert.throws(() => takeGrant(id, 'retry', 'p1', 'GACCOUNT', 'testnet'), {
    code: 'invalid_fee_approval',
  })
  for (const [call, target, account, network] of [
    ['retry', 'p2', 'GACCOUNT', 'testnet'],
    ['shield', 'p1', 'GACCOUNT', 'testnet'],
    ['retry', 'p1', 'GOTHER', 'testnet'],
    ['retry', 'p1', 'GACCOUNT', 'mainnet'],
  ]) {
    const other = issueGrant(grant())
    assert.throws(() => takeGrant(other, call, target, account, network), {
      code: 'invalid_fee_approval',
    })
    // A refused offer is used up as well.
    assert.throws(() => takeGrant(other, 'retry', 'p1', 'GACCOUNT', 'testnet'), {
      code: 'invalid_fee_approval',
    })
  }
  for (const forged of [{ inclusionCap: '100000', ceiling: '16600000' }, 'made-up', 7]) {
    assert.throws(() => takeGrant(forged, 'retry', 'p1', 'GACCOUNT', 'testnet'), {
      code: 'invalid_fee_approval',
    })
  }
})

test('a lock or an account switch ends every open offer', () => {
  const id = issueGrant(grant())
  declineAllReviews()
  assert.throws(() => takeGrant(id, 'retry', 'p1', 'GACCOUNT', 'testnet'), {
    code: 'invalid_fee_approval',
  })
  const next = issueGrant(grant())
  dropGrants()
  assert.throws(() => takeGrant(next, 'retry', 'p1', 'GACCOUNT', 'testnet'), {
    code: 'invalid_fee_approval',
  })
})

// A signer that signs whatever it is given, and the envelopes it was asked to sign.
function recordingSigner(keypair) {
  const signed = []
  return {
    signed,
    signer: {
      publicKey: keypair.publicKey(),
      async signTransaction(envelope) {
        signed.push(envelope)
        return envelope
      },
    },
  }
}

function envelope(keypair, fee, sequence = '1') {
  return new TransactionBuilder(new Account(keypair.publicKey(), sequence), {
    fee: String(fee),
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(30)
    .build()
    .toXDR()
}

test('a call signs envelopes whose fees add up to at most the most it was shown', async () => {
  const keypair = Keypair.random()
  // A restore before the call, then the call: together above an approved 16.6 XLM.
  {
    const { signed, signer } = recordingSigner(keypair)
    const call = budgetSigner(signer, 16_600_000n)
    await call.signTransaction(envelope(keypair, 15_000_000), Networks.TESTNET)
    await assert.rejects(
      call.signTransaction(envelope(keypair, 2_000_000, '2'), Networks.TESTNET),
      {
        code: 'signer_mismatch',
        details: { feeBudget: true },
      }
    )
    assert.equal(signed.length, 1)
  }
  // A network approval that a restore before the call would take twice.
  {
    const { signer } = recordingSigner(keypair)
    const call = budgetSigner(signer, 16_600_000n)
    await call.signTransaction(envelope(keypair, 16_000_000), Networks.TESTNET)
    await assert.rejects(
      call.signTransaction(envelope(keypair, 16_000_000, '2'), Networks.TESTNET),
      {
        code: 'signer_mismatch',
      }
    )
  }
  // The default: a silent restore and the call each within 1.01 XLM, but not both.
  {
    const { signer } = recordingSigner(keypair)
    const call = budgetSigner(signer, DEFAULT_FEE_BUDGET)
    await call.signTransaction(envelope(keypair, 6_000_000), Networks.TESTNET)
    await assert.rejects(
      call.signTransaction(envelope(keypair, 5_000_000, '2'), Networks.TESTNET),
      {
        code: 'signer_mismatch',
      }
    )
  }
  // Within the budget both are signed.
  {
    const { signed, signer } = recordingSigner(keypair)
    const call = budgetSigner(signer, 16_600_000n)
    await call.signTransaction(envelope(keypair, 15_000_000), Networks.TESTNET)
    await call.signTransaction(envelope(keypair, 1_600_000, '2'), Networks.TESTNET)
    assert.equal(signed.length, 2)
  }
})

test('the budget refusal reads as plain text and is not a payment that may land', () => {
  const view = errorView(
    new MayStillLand(fail('signer_mismatch', { feeBudget: true, planId: 'p9' }))
  )
  assert.equal(view.mayLand, undefined)
  assert.match(view.message, /go past the most you were shown/)
})

test('a shield sent and stopped on a fee keeps saying it may land', () => {
  const view = errorView(
    new MayStillLand(
      fail('fee_above_cap', { inclusion: '1', resource: '20000000', reason: 'network' })
    )
  )
  assert.equal(view.mayLand, true)
})

// Codes, entry names and SDK words that must never reach the user's text.
const LEAK = /_|vault|Roots|NextLeaf|Nullifier|stroops|selfRelay|networkFeeCaps/

function assertClean(view) {
  assert.doesNotMatch(view.message, LEAK, view.message)
}

test('a network fee above the caps opens a fee review and is not a payment that may land', () => {
  const err = fail('fee_above_cap', {
    inclusion: '150',
    resource: '65000000',
    reason: 'restore',
    entries: 'code,Roots,Frontier,asset Balance,code abcd',
    entryKinds: 'code,tree,tree,balance,other',
    planId: 'p1',
  })
  for (const view of [errorView(err), errorView(new MayStillLand(err))]) {
    assert.equal(view.mayLand, undefined)
    assert.equal(view.planId, 'p1')
    assert.deepEqual(view.fee, {
      reason: 'restore',
      total: '65000150',
      inclusionCap: '100000',
      ceiling: '71600000',
      most: '71600000',
      entries: ['code', 'tree', 'balance', 'other'],
    })
    assertClean(view)
  }
})

test('the relayer fee caps keep their text, and a queued one says the pool has a queue', () => {
  const relayer = errorView(fail('fee_above_cap', { fee: '2000000', cap: '1000000' }))
  assert.equal(relayer.message, 'The relayer asks 0.2 XLM, above the 0.1 XLM this wallet allows.')
  assert.equal(relayer.fee, undefined)
  const queued = errorView(
    fail('fee_above_cap', { fee: '20000000', cap: '10000000', queued: true })
  )
  assert.equal(queued.queued, true)
  assert.equal(queued.mayLand, undefined)
  assert.match(queued.message, /^The pool has a queue today, so the relayer asks 2 XLM, more/)
})

test('a fee above what one transaction carries names the limit to two decimals', () => {
  const view = errorView(
    new MayStillLand(
      fail('fee_above_limit', {
        inclusion: '100',
        resource: '5000000000',
        limit: '4294967295',
        feeBump: 'unsupported',
        planId: 'p2',
      })
    )
  )
  assert.equal(view.mayLand, undefined)
  assert.equal(view.planId, 'p2')
  assert.equal(
    view.message,
    'The network is asking about 500.00001 XLM, more than one transaction can carry (429.49 XLM). It cannot be sent from your account right now. Nothing was sent and your funds are unchanged.'
  )
})

test('a failed restore is not a payment that may land, and names its transaction', () => {
  const hash = 'a'.repeat(64)
  const view = errorView(new MayStillLand(fail('restore_failed', { hash, planId: 'p3' })))
  assert.equal(view.mayLand, undefined)
  assert.equal(view.hash, hash)
  assert.equal(errorView(fail('restore_failed', { hash: 'not a hash' })).hash, undefined)
  assertClean(view)
})

test('an open payment to the same address is named as the one to open, not as this one', () => {
  const view = errorView(fail('operation_open', { planId: 'open-1' }))
  assert.equal(view.openPlanId, 'open-1')
  assert.equal(view.planId, undefined)
  assert.equal(view.mayLand, undefined)
  assertClean(view)
  assert.equal(errorView(fail('operation_open', { operationId: 'op' })).openPlanId, undefined)
})

test('relayer refusals the user can act on are not payments that may land', () => {
  for (const code of ['network_fee_high', 'restore_needed']) {
    const view = errorView(fail('service_rejected', { code, networkFee: '99', planId: 'p4' }))
    assert.equal(view.refusal, code)
    assert.equal(view.mayLand, undefined)
    assert.doesNotMatch(view.message, /99/)
    assertClean(view)
  }
})

test('any other error of a saved payment may still land', () => {
  for (const err of [
    fail('service_rejected', { code: 'rejected', reason: 123, planId: 'p5' }),
    fail('transaction_failed', { planId: 'p5' }),
    fail('unexpected_error', { planId: 'p5' }),
  ]) {
    const view = errorView(err)
    assert.equal(view.mayLand, true, err.code)
    assert.equal(view.refusal, undefined)
    assertClean(view)
  }
  assert.equal(
    errorView(fail('service_rejected', { code: 'rejected', planId: 'p5' })).message,
    'The relayer refused the payment. Try again later.'
  )
  assert.equal(
    errorView(fail('service_rejected', { code: 'fee_too_low' })).message,
    "The relayer's fee changed while this was prepared. Try again."
  )
})

test('archive, history and refused-note errors read as plain text', () => {
  const views = [
    fail('archive_conflict', { windows: '1,2', copies: 'https://a https://b' }),
    fail('archive_fault'),
    fail('notes_refused'),
    fail('transaction_failed', { archived: true }),
    ...[
      'rpc_retention',
      'archive_unconfigured',
      'archive_unreachable',
      'archive_gap',
      'rpc_behind',
      'rpc_tail_short',
    ].map((reason) => fail('history_unavailable', { reason })),
  ].map(errorView)
  for (const view of views) assertClean(view)
  assert.doesNotMatch(views[0].message, /https/)
  assert.match(views[3].message, /^The pool's data moved into storage/)
})

test('a review shows a queued fee beside the usual one, and the queue warning in pool words', () => {
  const review = {
    kind: 'unshield',
    amount: 50n * XLM,
    fee: 3_000_000n,
    to: 'G',
    relayer: 'https://relayer.example',
    warnings: [{ code: 'exit_will_queue', message: 'the vault queues it' }],
    parts: 1,
    queued: true,
  }
  const view = reviewView('r', review, false, 2_000_000n)
  assert.deepEqual(view.queued, { usual: '2000000' })
  assert.doesNotMatch(view.warnings[0].message, /vault/)
  assert.equal(reviewView('r', { ...review, fee: 2_000_000n }, false, 2_000_000n).queued, null)
  assert.equal(reviewView('r', review, false, undefined).queued, null)
  assert.equal(reviewView('r', { ...review, relayer: undefined }, false, 2_000_000n).queued, null)
})

test('the signer signs a restore of the pool entries and nothing else of that kind', async () => {
  const deployment = PINNED_DEPLOYMENTS['testnet/xlm']
  const keypair = Keypair.random()
  const signer = vaultSigner(keypair, deployment)
  const entry = (contract) =>
    xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: Address.fromString(contract).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      })
    )
  const keyed = (contract, name) =>
    xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: Address.fromString(contract).toScAddress(),
        key: xdr.ScVal.scvVec([
          xdr.ScVal.scvSymbol(name),
          Address.fromString(keypair.publicKey()).toScVal(),
        ]),
        durability: xdr.ContractDataDurability.persistent(),
      })
    )
  const code = (hex) =>
    xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.from(hex, 'hex') }))
  const restore = (keys) =>
    new TransactionBuilder(new Account(keypair.publicKey(), '1'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.restoreFootprint({}))
      .setSorobanData(new SorobanDataBuilder().setReadWrite(keys).build())
      .setTimeout(30)
      .build()
      .toXDR()
  const ours = [
    code(deployment.vaultWasmHash),
    entry(deployment.vault),
    entry(deployment.asset.contract),
    keyed(deployment.asset.contract, 'Balance'),
  ]
  assert.equal(typeof (await signer.signTransaction(restore(ours), Networks.TESTNET)), 'string')
  const other = Keypair.random().publicKey()
  for (const keys of [
    [...ours, entry(Address.contract(Buffer.alloc(32, 7)).toString())],
    [code('00'.repeat(32))],
    [keyed(deployment.asset.contract, 'Allowance')],
  ]) {
    await assert.rejects(signer.signTransaction(restore(keys), Networks.TESTNET), {
      code: 'signer_mismatch',
    })
  }
  const foreign = new TransactionBuilder(new Account(other, '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setSorobanData(new SorobanDataBuilder().setReadWrite(ours).build())
    .setTimeout(30)
    .build()
    .toXDR()
  await assert.rejects(signer.signTransaction(foreign, Networks.TESTNET), {
    code: 'signer_mismatch',
  })
})
