import { Keypair, TransactionBuilder, hash } from '@stellar/stellar-sdk'

// Per-family signing boundary: code that turns key material into signatures
// lives here, so adding a chain family means adding a signer module instead
// of another inline Keypair call site in the service router.

export function signTransactionXdr(xdr: string, networkPassphrase: string, secret: string): string {
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase)
  tx.sign(Keypair.fromSecret(secret))
  return tx.toEnvelope().toXDR('base64')
}

const SEP53_PREFIX = 'Stellar Signed Message:\n'

// SEP-53: sign SHA-256(prefix || message), never the raw bytes. Raw signing would
// let a dApp pass a transaction hash off as a "message" and get it signed.
export function signMessageSep53(message: string, secret: string): string {
  const payload = Buffer.concat([Buffer.from(SEP53_PREFIX, 'utf8'), Buffer.from(message, 'utf8')])
  return Keypair.fromSecret(secret).sign(hash(payload)).toString('base64')
}
