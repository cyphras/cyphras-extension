import { CyphrasError, type Deployment, type TransactionSigner } from '@cyphras/private'
import { Address, type Keypair, Transaction, TransactionBuilder } from '@stellar/stellar-sdk'

// True for a transaction from `source` whose one operation calls the vault.
function callsVault(tx: Transaction, source: string, vault: string): boolean {
  if (tx.source !== source || tx.operations.length !== 1) return false
  const op = tx.operations[0]
  if (op.type !== 'invokeHostFunction') return false
  if (op.func.switch().name !== 'hostFunctionTypeInvokeContract') return false
  return Address.fromScAddress(op.func.invokeContract().contractAddress()).toString() === vault
}

// True for a transaction from `source` whose one operation restores archived entries of this
// deployment alone: the vault's pinned code, the vault's own entries, and its asset contract's
// instance and balances, as the SDK restores before a vault call or for a restore of the pool.
function restoresVault(tx: Transaction, source: string, deployment: Deployment): boolean {
  if (tx.source !== source || tx.operations.length !== 1) return false
  if (tx.operations[0].type !== 'restoreFootprint') return false
  const ext = tx.toEnvelope().v1().tx().ext()
  if (ext.switch() !== 1) return false
  const footprint = ext.sorobanData().resources().footprint()
  const keys = footprint.readWrite()
  if (footprint.readOnly().length > 0 || keys.length === 0) return false
  return keys.every((key) => {
    const kind = key.switch().name
    if (kind === 'contractCode') {
      const hash = [...key.contractCode().hash()].map((b) => b.toString(16).padStart(2, '0'))
      return hash.join('') === deployment.vaultWasmHash
    }
    if (kind !== 'contractData') return false
    const data = key.contractData()
    const contract = Address.fromScAddress(data.contract()).toString()
    if (contract === deployment.vault) return true
    if (contract !== deployment.asset.contract) return false
    const k = data.key()
    if (k.switch().name === 'scvLedgerKeyContractInstance') return true
    const first = k.switch().name === 'scvVec' ? k.vec()?.[0] : undefined
    return first?.switch().name === 'scvSymbol' && first.sym().toString() === 'Balance'
  })
}

// A refusal the SDK knows as its own, so a deposit whose signature is refused is voided rather
// than left submitting.
function refuse(message: string): never {
  throw new CyphrasError('signer_mismatch', message)
}

// The account's key signs what the SDK builds as that account: a shield, a self-relayed unshield,
// the vault's cancel, refund and claim, and a restore of the pool's archived entries. It signs
// nothing but a call of this deployment's vault, or a restore of its entries, on this deployment's
// network. It takes no fee bumps, so a fee above what one envelope carries is refused before
// anything is signed.
export function vaultSigner(keypair: Keypair, deployment: Deployment): TransactionSigner {
  const publicKey = keypair.publicKey()
  return {
    publicKey,
    async signTransaction(envelope: string, networkPassphrase: string): Promise<string> {
      if (networkPassphrase !== deployment.networkPassphrase) {
        refuse('refused to sign for another network')
      }
      let tx: ReturnType<typeof TransactionBuilder.fromXDR>
      try {
        tx = TransactionBuilder.fromXDR(envelope, networkPassphrase)
      } catch {
        return refuse('the transaction to sign could not be read')
      }
      if (
        !(tx instanceof Transaction) ||
        !(callsVault(tx, publicKey, deployment.vault) || restoresVault(tx, publicKey, deployment))
      ) {
        refuse('refused to sign a transaction that is not a call of the vault')
      }
      tx.sign(keypair)
      return tx.toXDR()
    },
  }
}
