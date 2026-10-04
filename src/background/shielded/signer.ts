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

// A refusal the SDK knows as its own, so a deposit whose signature is refused is voided rather
// than left submitting.
function refuse(message: string): never {
  throw new CyphrasError('signer_mismatch', message)
}

// The account's key signs what the SDK builds as that account: a shield, a self-relayed unshield
// and the vault's cancel, refund and claim. It signs nothing but a call of this deployment's vault
// on this deployment's network.
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
      if (!(tx instanceof Transaction) || !callsVault(tx, publicKey, deployment.vault)) {
        refuse('refused to sign a transaction that is not a call of the vault')
      }
      tx.sign(keypair)
      return tx.toXDR()
    },
  }
}
