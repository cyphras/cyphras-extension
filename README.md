<div align="center">
  <img src="src/app/public/icon.svg" width="88" alt="Cyphras">
  <h1>Cyphras</h1>
  <p>A non-custodial browser wallet for Stellar, Ethereum and Bitcoin.</p>

  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/manifest-v3-orange.svg" alt="Manifest v3">
  <img src="https://img.shields.io/badge/version-0.3.0-22c55e.svg" alt="Version">
</div>

---

Hold, send, swap and bridge from one recovery phrase, and connect to Stellar dApps, all from your browser.

## Features

- Stellar, Ethereum and Bitcoin (native SegWit) accounts from one recovery phrase, with every balance and its history in one list
- Swap on the Stellar DEX, with a warning before a swap loses value
- Bridge native USDC between Ethereum and Stellar with Circle CCTP
- Private mode (testnet preview): shield XLM into a private balance, pay private addresses (`cyt1...`) and unshield to any Stellar address, with zero-knowledge proofs made on your device. Deposits are screened before they enter the pool, and a payment that may still land is never sent twice
- Connect to Stellar dApps with one approval flow, and sign transactions, messages (SEP-53) and authorization entries
- Create or import wallets with a recovery phrase or a Stellar secret key, with several wallets and accounts side by side
- Custom assets and tokens, and custom Stellar networks and RPC endpoints
- Automatic lock with a configurable timeout
- Runs as a popup, in the side panel or in a tab

## Development

**Requirements:** Node.js 20.19+ or 22.13+ (CI uses 24)

```bash
npm ci
npm run build
```

`npm test` runs the unit tests. Load the `dist/` folder as an unpacked extension in Chrome (`chrome://extensions` > Load unpacked).

## SDK

dApp developers can integrate with Cyphras using the [`@cyphras/sdk`](https://github.com/cyphras/cyphras-sdk) package.

## License

The source code in this repository is licensed under Apache 2.0. See [LICENSE](LICENSE) for details.

The built extension includes GPL-3.0 components (snarkjs and `@cyphras/private-prover-snarkjs`), so the package as distributed is conveyed under GPL-3.0. Its complete source is this repository at the release tag. [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt), which the build also puts in the package, lists every bundled third-party component with its license.
