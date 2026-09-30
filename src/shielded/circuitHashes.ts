// SHA-256 of bundled circuit artifacts, checked before proving so a swapped artifact cannot prove against the wrong circuit.
export const SHIELDED_ARTIFACT_SHA256: Record<string, string> = {
  "circuits/transaction.wasm": "a790bb73ebbf7c82b523b2c3bef085dbb5c28b351f320892e14666fc62c9c879",
  "circuits/transaction.zkey": "703de49d3368057d9668636a4fcf38216b72356dcb3fb2ed2141a67d9ee48024",
  "circuits/poseidon2_1_main.wasm": "65e7fd308ee5448fb93d79a862ac369ee565ebb7b1337c17732c53a27b7adb8d",
  "circuits/poseidon2_2_main.wasm": "bb66bd55a493b59bfedcb59a60524675ca90151bbc7ce0d4682ef20fa700ee32",
  "circuits/poseidon2_3_main.wasm": "6c74972fb7e5310c1415ba65d4c4375bccf2b1b8838c7f9715d6b3d8fd317e94",
  "circuits/poseidon2_compress_main.wasm": "bd6b6717bede08a72966674bd64a1a983e65014b785521b7073c6410f39993d3",
};

export const SHIELDED_ZKEY = "circuits/transaction.zkey";

// The solo trusted setup is forgeable, so refuse to prove on any non-testnet network.
export function assertShieldedNetwork(network: string): void {
  if (network !== "testnet") throw new Error("shielded proving is testnet only");
}
