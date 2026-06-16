// SHA-256 of the bundled Groth16 circuit artifacts, verified at load so a tampered or swapped
// wasm/zkey is rejected before it can produce a proof against the wrong circuit. Regenerate after any
// circuit or trusted-setup change (e.g. swapping in the mainnet ceremony zkey):
//   shasum -a 256 src/app/public/circuit/withdraw.wasm src/app/public/circuit/withdraw.zkey
export const CIRCUIT_WASM_SHA256 =
  '94eedc4aa73b601b2a9967fe1486896227014f745c611d8816c845991165644a'
export const CIRCUIT_ZKEY_SHA256 =
  'a6f5b9932f340fc8239e9dd4238e7cfc42f3415a6779d5e86b4003fefda31a61'
