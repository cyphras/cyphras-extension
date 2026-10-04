import type { Deployment, TransactionSigner } from '@cyphras/private'
import { Address, type Keypair, Transaction, TransactionBuilder } from '@stellar/stellar-sdk'

// True for a transaction from `source` whose one operation calls the vault.
function callsVault(tx: Transaction, source: string, vault: string): boolean {
  if (tx.source !== source || tx.operations.length !== 1) return false
  const op = tx.operations[0]
  if (op.type !== 'invokeHostFunction') return false
  if (op.func.switch().name !== 'hostFunctionTypeInvokeContract') return false
  return Address.fromScAddress(op.func.invokeContract().contractAddress()).toString() === vault
}

// The account's key signs what the SDK builds as that account: a shield, or a self-relayed
// unshield. It signs nothing but a call of this deployment's vault on this deployment's network.
export function vaultSigner(keypair: Keypair, deployment: Deployment): TransactionSigner {
  const publicKey = keypair.publicKey()
  return {
    publicKey,
    async signTransaction(envelope: string, networkPassphrase: string): Promise<string> {
      if (networkPassphrase !== deployment.networkPassphrase) {
        throw new Error('refused to sign for another network')
      }
      const tx = TransactionBuilder.fromXDR(envelope, networkPassphrase)
      if (!(tx instanceof Transaction) || !callsVault(tx, publicKey, deployment.vault)) {
        throw new Error('refused to sign a transaction that is not a call of the vault')
      }
      tx.sign(keypair)
      return tx.toXDR()
    },
  }
}
