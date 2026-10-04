import {
  PINNED_DEPLOYMENTS,
  type ArtifactName,
  type Deployment,
  type DeploymentName,
} from '@cyphras/private'

// A vault the SDK release pins, the RPC private mode reads it through, where the extension ships
// its circuit files, and the most the wallet lets a relayer charge for one payment. The RPC is
// fixed here rather than taken from network settings, since it decides which notes, roots and
// payment fates the wallet believes.
export interface ShieldedDeployment {
  readonly name: DeploymentName
  readonly deployment: Deployment
  readonly rpcUrl: string
  readonly artifactPaths: Readonly<Record<ArtifactName, string>>
  readonly maxRelayerFee: bigint
}

// The testnet proving key comes from a solo setup that anyone holding it can forge proofs with.
const TESTNET_ARTIFACTS: Readonly<Record<ArtifactName, string>> = {
  wasm: 'circuits/testnet/transaction.wasm',
  zkey: 'circuits/testnet/transaction.zkey',
  vkey: 'circuits/testnet/verification_key.json',
}

function pinned(
  name: DeploymentName,
  rpcUrl: string,
  artifactPaths: Readonly<Record<ArtifactName, string>>,
  maxRelayerFee: bigint
): [string, ShieldedDeployment][] {
  const deployment = PINNED_DEPLOYMENTS[name]
  return deployment ? [[name, { name, deployment, rpcUrl, artifactPaths, maxRelayerFee }]] : []
}

// By the deployment name the network config gives a pool. A deployment the SDK release does not
// pin is missing, so private mode refuses its pool.
export const SHIELDED_DEPLOYMENTS: Readonly<Record<string, ShieldedDeployment>> =
  Object.fromEntries(
    pinned('testnet/xlm', 'https://soroban-testnet.stellar.org', TESTNET_ARTIFACTS, 10_000_000n)
  )
