// Edges of the fee review: the signer never takes a fee bump, the stated slack is the slack the
// ceiling gives, and a review asked again says how the new fee compares with the approval.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveSources } from './support/sources.mjs'

resolveSources()

const { PINNED_DEPLOYMENTS } = await import('@cyphras/private')
const { Account, Keypair, Networks, Operation, TransactionBuilder } =
  await import('@stellar/stellar-sdk')
const { feeCeiling } = await import('../src/background/shielded/fees.ts')
const { vaultSigner } = await import('../src/background/shielded/signer.ts')
const { feeChangedText, feeNotes } = await import('../src/app/src/lib/privateFees.ts')

const xlm = (stroops) => {
  const frac = (stroops % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '')
  return `${stroops / 10_000_000n}${frac ? `.${frac}` : ''}`
}

test('the signer takes no fee bumps, so a fee above one envelope stops before signing', async () => {
  const deployment = PINNED_DEPLOYMENTS['testnet/xlm']
  const keypair = Keypair.random()
  const signer = vaultSigner(keypair, deployment)
  assert.equal(signer.signsFeeBumps, undefined)
  const inner = new TransactionBuilder(new Account(keypair.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({ contract: deployment.vault, function: 'x', args: [] })
    )
    .setTimeout(30)
    .build()
  inner.sign(keypair)
  const bump = TransactionBuilder.buildFeeBumpTransaction(keypair, '200', inner, Networks.TESTNET)
  await assert.rejects(signer.signTransaction(bump.toXDR(), Networks.TESTNET), {
    code: 'signer_mismatch',
  })
})

test('the most a review lets a transaction pay is the fee plus the 10% its note states', () => {
  // A 1.5 XLM resource fee with the network's lowest inclusion bid.
  const inclusion = 150n
  const resource = 15_000_000n
  const total = inclusion + resource
  const { ceiling } = feeCeiling(inclusion.toString(), resource.toString())
  const { notes } = feeNotes('network', 'unshield', 'GABC...WXYZ', false)
  const slackNote = notes.find((n) => /10%/.test(n))
  assert.ok(slackNote)
  if (/never more/.test(slackNote)) {
    const tenPercentOver = (total * 11n + 9n) / 10n
    assert.ok(
      ceiling <= tenPercentOver,
      `the note says the fee plus 10%, never more, which is ${xlm(tenPercentOver)} XLM, and the review approves ${xlm(ceiling)} XLM`
    )
  }
})

test('a review asked again for a fee below the approval does not call it above the approval', () => {
  // An approval of a restore leaves the call after it the default room only, so a plain 1.5 XLM
  // fee there is asked again although 7 XLM was approved.
  const text = feeChangedText('1.5', '7')
  assert.doesNotMatch(text, /above the 7 XLM you approved/)
})
