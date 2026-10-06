// Every cost of a bridge: real figures where the tx can be built before
// signing (Soroban simulation, live EVM gas price), labeled estimates for the
// destination mint, which cannot be built until Circle attests the burn.
import {
  Account,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk'
import { CCTP_FINALITY_FAST, CCTP_FINALITY_STANDARD, CCTP_DOMAIN_ETHEREUM } from '@constants/cctp'
import type { CctpFeeBreakdown, CctpFeeLeg } from '@ext-types/index'
import { evmAddressToBytes32 } from './encoding'
import {
  sorobanRpcCall,
  evmRpcCall,
  decimalToBaseUnits,
  baseUnitsToDecimal,
  type CctpReadEnv,
} from './burn'

// Typical gas for the CCTP V2 calls, used with the live gas price; the real
// submission still estimates gas itself.
const EVM_GAS_APPROVE = 60_000n
const EVM_GAS_BURN = 200_000n
const EVM_GAS_MINT = 220_000n
// Assumed per Soroban call when simulation fails (no allowance yet, unfunded
// account, RPC error); observed CCTP calls land well under this.
const STELLAR_SOROBAN_FEE_FALLBACK_STROOPS = 500_000n // 0.05 XLM
// Mirror the processor's spare-balance floors for submitting a mint, shown so
// a mint paused for gas is no surprise.
const STELLAR_MINT_RESERVE_STROOPS = 5_000_000n // 0.5 XLM
const EVM_MINT_RESERVE_WEI = 2_000_000_000_000_000n // 0.002 ETH
const APPROVAL_LEDGER_MARGIN = 100_000

async function stellarSequence(env: CctpReadEnv, address: string): Promise<string | null> {
  try {
    const res = await fetch(`${env.horizonUrl}/accounts/${address}`)
    if (!res.ok) return null
    const data = (await res.json()) as { sequence: string }
    return data.sequence
  } catch {
    return null
  }
}

async function simulateFeeStroops(
  env: CctpReadEnv,
  source: string,
  sequence: string,
  contractId: string,
  method: string,
  args: ReturnType<typeof nativeToScVal>[]
): Promise<bigint | null> {
  try {
    const tx = new TransactionBuilder(new Account(source, sequence), {
      fee: BASE_FEE,
      networkPassphrase: env.passphrase,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(env.txTimeout)
      .build()
    const sim = await sorobanRpcCall<{ error?: string; minResourceFee?: string }>(
      env.sorobanRpcUrl,
      'simulateTransaction',
      {
        transaction: tx.toEnvelope().toXDR('base64'),
        resourceConfig: { instructionLeeway: 3_000_000 },
      }
    )
    if (sim.error || !sim.minResourceFee) return null
    return BigInt(BASE_FEE) + BigInt(sim.minResourceFee)
  } catch {
    return null
  }
}

async function evmGasPriceWei(env: CctpReadEnv): Promise<bigint | null> {
  try {
    return BigInt(await evmRpcCall(env.evmRpcUrl, 'eth_gasPrice', []))
  } catch {
    return null
  }
}

function xlmLeg(stroops: bigint, estimated: boolean, reserve?: bigint): CctpFeeLeg {
  return {
    code: 'XLM',
    amount: baseUnitsToDecimal(stroops, 7),
    estimated,
    reserveHint: reserve === undefined ? undefined : baseUnitsToDecimal(reserve, 7),
  }
}

function ethLeg(wei: bigint | null, gasUnits: bigint, reserve?: bigint): CctpFeeLeg {
  return {
    code: 'ETH',
    amount: wei === null ? '0' : baseUnitsToDecimal(wei * gasUnits, 18),
    estimated: wei === null,
    reserveHint: reserve === undefined ? undefined : baseUnitsToDecimal(reserve, 18),
  }
}

export async function buildCctpFeeBreakdown(
  env: CctpReadEnv,
  params: {
    direction: 'stellar-to-evm' | 'evm-to-stellar'
    amount: string
    speed: 'standard' | 'fast'
    circleFee: string
    stellarAddress?: string
    evmAddress?: string
  }
): Promise<CctpFeeBreakdown> {
  const { direction, amount, speed, circleFee, stellarAddress, evmAddress } = params
  const amount6 = decimalToBaseUnits(amount, 6)
  const fee6 = decimalToBaseUnits(circleFee, 6)
  const receiveMin = baseUnitsToDecimal(amount6 > fee6 ? amount6 - fee6 : 0n, 6)
  const finality = speed === 'fast' ? CCTP_FINALITY_FAST : CCTP_FINALITY_STANDARD

  if (direction === 'stellar-to-evm') {
    let approveFee: bigint | null = null
    let burnFee: bigint | null = null
    const sequence = stellarAddress ? await stellarSequence(env, stellarAddress) : null
    if (stellarAddress && sequence) {
      const amount7 = decimalToBaseUnits(amount, 7)
      const latest = await sorobanRpcCall<{ sequence: number }>(
        env.sorobanRpcUrl,
        'getLatestLedger'
      ).catch(() => null)
      if (latest) {
        approveFee = await simulateFeeStroops(
          env,
          stellarAddress,
          sequence,
          env.anchors.stellar.usdcSac,
          'approve',
          [
            nativeToScVal(stellarAddress, { type: 'address' }),
            nativeToScVal(env.anchors.stellar.tokenMessengerMinter, { type: 'address' }),
            nativeToScVal(amount7, { type: 'i128' }),
            nativeToScVal(latest.sequence + APPROVAL_LEDGER_MARGIN, { type: 'u32' }),
          ]
        )
      }
      if (evmAddress) {
        burnFee = await simulateFeeStroops(
          env,
          stellarAddress,
          sequence,
          env.anchors.stellar.tokenMessengerMinter,
          'deposit_for_burn',
          [
            nativeToScVal(stellarAddress, { type: 'address' }),
            nativeToScVal(amount7, { type: 'i128' }),
            nativeToScVal(CCTP_DOMAIN_ETHEREUM, { type: 'u32' }),
            nativeToScVal(Buffer.from(evmAddressToBytes32(evmAddress)), { type: 'bytes' }),
            nativeToScVal(env.anchors.stellar.usdcSac, { type: 'address' }),
            nativeToScVal(Buffer.alloc(32), { type: 'bytes' }),
            nativeToScVal(decimalToBaseUnits(circleFee, 7), { type: 'i128' }),
            nativeToScVal(finality, { type: 'u32' }),
          ]
        )
      }
    }
    const estimated = approveFee === null || burnFee === null
    const total =
      (approveFee ?? STELLAR_SOROBAN_FEE_FALLBACK_STROOPS) +
      (burnFee ?? STELLAR_SOROBAN_FEE_FALLBACK_STROOPS)
    const gasPrice = await evmGasPriceWei(env)
    return {
      circleFee,
      receiveMin,
      source: xlmLeg(total, estimated),
      destination: ethLeg(gasPrice, EVM_GAS_MINT, EVM_MINT_RESERVE_WEI),
    }
  }

  const gasPrice = await evmGasPriceWei(env)
  return {
    circleFee,
    receiveMin,
    source: ethLeg(gasPrice, EVM_GAS_APPROVE + EVM_GAS_BURN),
    destination: xlmLeg(STELLAR_SOROBAN_FEE_FALLBACK_STROOPS, true, STELLAR_MINT_RESERVE_STROOPS),
  }
}
