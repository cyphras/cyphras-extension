import {
  Account,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk'

export interface FactoryConfig {
  factoryId: string
  rpcUrl: string
  networkPassphrase: string
}

export class FactoryError extends Error {}

// The requested pool does not match the one the factory registered. Permanent (unlike a transient
// FactoryError from RPC/simulation), so the caller must not retry the commit.
export class PoolMismatchError extends FactoryError {}

// Read a factory getter via simulation: nothing is signed or submitted, so any existing source account
// and a zero sequence work (the result never reaches the network).
async function callGetter(
  cfg: FactoryConfig,
  source: string,
  method: string,
  args: xdr.ScVal[]
): Promise<unknown> {
  const server = new rpc.Server(cfg.rpcUrl)
  const account = new Account(source, '0')
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: cfg.networkPassphrase,
  })
    .addOperation(new Contract(cfg.factoryId).call(method, ...args))
    .setTimeout(30)
    .build()
  const sim = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim)) {
    throw new FactoryError(`factory.${method} simulation failed: ${sim.error}`)
  }
  const retval = sim.result?.retval
  return retval ? scValToNative(retval) : null
}

export async function lookupPool(
  cfg: FactoryConfig,
  source: string,
  token: string,
  denomination: bigint
): Promise<string | null> {
  const result = await callGetter(cfg, source, 'get_pool', [
    nativeToScVal(token, { type: 'address' }),
    nativeToScVal(denomination, { type: 'i128' }),
  ])
  // get_pool returns Option<Address>. Absent is a legitimate "no pool"; any other shape is a getter
  // bug and must not read as a clean negative at the fund-safety gate.
  if (result === null || result === undefined) {
    return null
  }
  if (typeof result !== 'string') {
    throw new FactoryError(`unexpected get_pool result shape: ${typeof result}`)
  }
  return result
}

// Fund-safety gate before any commit: the relayer is untrusted and could name a pool it controls, so
// confirm the address is the one the factory registered for this (token, denomination) before funds move.
export async function assertPoolRegistered(
  cfg: FactoryConfig,
  source: string,
  token: string,
  denomination: bigint,
  pool: string
): Promise<void> {
  const registered = await lookupPool(cfg, source, token, denomination)
  if (registered !== pool) {
    throw new PoolMismatchError(
      `pool ${pool} is not the factory's pool for this asset and denomination (registry has ${registered ?? 'none'})`
    )
  }
}
