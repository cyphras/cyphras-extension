import {
  PINNED_DEPLOYMENTS,
  type ArtifactName,
  type Deployment,
  type DeploymentName,
} from '@cyphras/private'

// The RPC is fixed here, not taken from network settings, since it decides which notes, roots and
// payment fates the wallet believes; a second provider, when set, vetoes what it contradicts.
export interface ShieldedDeployment {
  readonly name: DeploymentName
  readonly deployment: Deployment
  readonly rpcUrl: string
  readonly secondRpcUrl?: string
  readonly artifactPaths: Readonly<Record<ArtifactName, string>>
  readonly maxRelayerFee: bigint
}

// The testnet proving key comes from a solo setup that anyone holding it can forge proofs with.
const TESTNET_ARTIFACTS: Readonly<Record<ArtifactName, string>> = {
  wasm: 'circuits/testnet/transaction.wasm',
  zkey: 'circuits/testnet/transaction.zkey',
  vkey: 'circuits/testnet/verification_key.json',
}

// The mainnet proving key comes from a multi-party ceremony, so no single party can forge proofs.
const MAINNET_ARTIFACTS: Readonly<Record<ArtifactName, string>> = {
  wasm: 'circuits/mainnet/transaction.wasm',
  zkey: 'circuits/mainnet/transaction.zkey',
  vkey: 'circuits/mainnet/verification_key.json',
}

const MAINNET_RPC_URL = 'https://mainnet.sorobanrpc.com'
// The SDK recommends a second provider on mainnet; without one, the first alone is believed.
const MAINNET_SECOND_RPC_URL: string | undefined = undefined

function pinned(
  name: DeploymentName,
  rpcUrl: string,
  artifactPaths: Readonly<Record<ArtifactName, string>>,
  maxRelayerFee: bigint,
  secondRpcUrl?: string
): [string, ShieldedDeployment][] {
  const deployment = PINNED_DEPLOYMENTS[name]
  return deployment
    ? [[name, { name, deployment, rpcUrl, secondRpcUrl, artifactPaths, maxRelayerFee }]]
    : []
}

// By the deployment name the network config gives a pool. A deployment the SDK release does not
// pin is missing, so private mode refuses its pool.
export const SHIELDED_DEPLOYMENTS: Readonly<Record<string, ShieldedDeployment>> =
  Object.fromEntries([
    ...pinned('testnet/xlm', 'https://soroban-testnet.stellar.org', TESTNET_ARTIFACTS, 10_000_000n),
    ...pinned(
      'mainnet/xlm',
      MAINNET_RPC_URL,
      MAINNET_ARTIFACTS,
      10_000_000n,
      MAINNET_SECOND_RPC_URL
    ),
  ])
