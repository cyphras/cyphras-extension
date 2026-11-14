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
const { feeApprovalCaps, feeCeiling, MAX_ENVELOPE_FEE } =
  await import('../src/background/shielded/fees.ts')
const { MayStillLand, errorView } = await import('../src/background/shielded/errors.ts')
const { reviewView } = await import('../src/background/shielded/reviews.ts')
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

test('no ceiling above what one envelope carries, and none from a malformed fee', () => {
  assert.equal(feeCeiling('100', '3904515000'), null)
  assert.ok(feeCeiling('100', '3904000000').ceiling <= MAX_ENVELOPE_FEE)
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

test('an approval becomes caps for its call, a restore above 1 XLM in the restore room', () => {
  const approval = (reason, inclusionCap, ceiling) => ({ reason, inclusionCap, ceiling })
  assert.deepEqual(feeApprovalCaps(approval('network', '100000', '16600000')), {
    inclusion: 100_000n,
    resource: 16_500_000n,
    restore: 0n,
  })
  assert.deepEqual(feeApprovalCaps(approval('rent', '100000', '5100000')), {
    inclusion: 100_000n,
    resource: 5_000_000n,
    restore: 0n,
  })
  assert.deepEqual(feeApprovalCaps(approval('restore', '100000', '70100000')), {
    inclusion: 100_000n,
    resource: XLM,
    restore: 60_000_000n,
  })
})

test('a malformed approval gives no caps', () => {
  for (const bad of [
    null,
    'yes',
    { reason: 'network', inclusionCap: '100000' },
    { reason: 'other', inclusionCap: '100000', ceiling: '200000' },
    { reason: 'network', inclusionCap: '300000', ceiling: '200000' },
    { reason: 'network', inclusionCap: '100000', ceiling: '4294967296' },
    { reason: 'network', inclusionCap: '-1', ceiling: '200000' },
    { reason: 'network', inclusionCap: 100000, ceiling: 200000 },
  ]) {
    assert.equal(feeApprovalCaps(bad), null, JSON.stringify(bad))
  }
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
  ]
  assert.equal(typeof (await signer.signTransaction(restore(ours), Networks.TESTNET)), 'string')
  const other = Keypair.random().publicKey()
  for (const keys of [
    [...ours, entry(Address.contract(Buffer.alloc(32, 7)).toString())],
    [code('00'.repeat(32))],
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
