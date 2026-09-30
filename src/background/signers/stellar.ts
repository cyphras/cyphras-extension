import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk'

// Per-family signing boundary: code that turns key material into signatures
// lives here, so adding a chain family means adding a signer module instead
// of another inline Keypair call site in the service router.

export function signTransactionXdr(xdr: string, networkPassphrase: string, secret: string): string {
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase)
  tx.sign(Keypair.fromSecret(secret))
  return tx.toEnvelope().toXDR('base64')
}

export function signMessageBytes(message: string, secret: string): string {
  const signature = Keypair.fromSecret(secret).sign(Buffer.from(message, 'utf8'))
  return btoa(String.fromCharCode(...signature))
}
