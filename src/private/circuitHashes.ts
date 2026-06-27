// SHA-256 of the bundled Groth16 circuit artifacts, verified at load so a tampered or swapped
// wasm/zkey is rejected before it can produce a proof against the wrong circuit. The wasm is the same
// circuit on every network; the zkey differs (testnet ships the dev/forgeable key, mainnet the Phase-2
// ceremony key), so the zkey is chosen per network. Regenerate after any circuit or trusted-setup change:
//   shasum -a 256 src/app/public/circuit/withdraw.wasm \
//     src/app/public/circuit/withdraw.testnet.zkey src/app/public/circuit/withdraw.mainnet.zkey
export const CIRCUIT_WASM_SHA256 =
  '94eedc4aa73b601b2a9967fe1486896227014f745c611d8816c845991165644a'

const CIRCUIT_ZKEY: Record<'testnet' | 'mainnet', { file: string; sha256: string }> = {
  testnet: {
    file: 'circuit/withdraw.testnet.zkey',
    sha256: 'a6f5b9932f340fc8239e9dd4238e7cfc42f3415a6779d5e86b4003fefda31a61',
  },
  mainnet: {
    file: 'circuit/withdraw.mainnet.zkey',
    sha256: '904ba52cae6485ecf0f95cadd14c6690ec3494a157ffd8febd7ab82c99c9d853',
  },
}

// mainnet uses the Phase-2 ceremony key; every other network (testnet and custom dev networks) uses the
// testnet dev key, matching the verifier each network ships against.
export function circuitZkey(network: string): { file: string; sha256: string } {
  return network === 'mainnet' ? CIRCUIT_ZKEY.mainnet : CIRCUIT_ZKEY.testnet
}
