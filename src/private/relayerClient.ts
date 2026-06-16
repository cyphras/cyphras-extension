import { FIELD_MODULUS } from './field.js'

export type PrivacyLevel = 'fast' | 'standard' | 'maximum'

export interface FeeQuote {
  asset: string
  feeStroops: string
  tierStroops: number
  validForSeconds: number
  relayer: string
  relayers: { publicKey: string; freeChannels: number }[]
}

export interface PoolInfo {
  address: string
  token: string
  asset: string
  denomination: string
  generation: number
  active: boolean
}

export interface ScheduleRequest {
  pool: string
  proof: string
  root: string
  nullifierHash: string
  amountHash: string
  recipient: string
  relayer?: string
  xlmFee: string
  privacyLevel?: PrivacyLevel
}

export interface ScheduleResult {
  jobId: string
  status: string
  scheduledFor: string
}

export interface JobStatus {
  id: string
  pool: string
  status: string
  txHash: string | null
  failureReason: string | null
  attempts: number
  scheduledFor: string
  createdAt: string
}

interface LeavesPage {
  pool: string
  from: number
  leaves: { leaf_index: number; commitment: string; root: string }[]
  nextFrom: number | null
}

export class RelayerError extends Error {}

export class RelayerClient {
  // network tags every request so a host serving testnet and mainnet routes to the right backend.
  constructor(
    private readonly baseUrl: string,
    private readonly network: string
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { 'X-Cyphras-Network': this.network, ...extra }
  }

  private async getJson<T>(path: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.url(path), { headers: this.headers() })
      // A read burst (processor + reveal + reclaim + polls) can trip the relayer's per-IP rate limit;
      // back off and retry rather than failing the whole flow.
      if (res.status === 429 && attempt < 3) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const waitMs =
          (Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) : attempt + 1) *
          1000
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      if (!res.ok) {
        throw new RelayerError(`GET ${path} failed with ${res.status}`)
      }
      return (await res.json()) as T
    }
  }

  async fee(): Promise<FeeQuote> {
    return this.getJson<FeeQuote>('/v1/info/fee')
  }

  async pools(): Promise<PoolInfo[]> {
    const body = await this.getJson<{ pools: PoolInfo[] }>('/v1/info/pools')
    return body.pools
  }

  // A skipped or reordered index would build a wrong Merkle path and an unredeemable proof, so any
  // gap must fail loudly rather than be trusted.
  async leaves(pool: string): Promise<bigint[]> {
    const out: bigint[] = []
    let from = 0
    for (;;) {
      const page = await this.getJson<LeavesPage>(`/v1/info/leaves/${pool}?from=${from}&limit=1000`)
      for (const row of page.leaves) {
        if (!Number.isInteger(row.leaf_index) || row.leaf_index !== out.length) {
          throw new RelayerError(`leaf index gap: expected ${out.length}, got ${row.leaf_index}`)
        }
        if (!/^[0-9a-f]{64}$/i.test(row.commitment)) {
          throw new RelayerError(`malformed leaf commitment at index ${row.leaf_index}`)
        }
        const value = BigInt('0x' + row.commitment)
        if (value >= FIELD_MODULUS) {
          throw new RelayerError(`non-canonical leaf commitment at index ${row.leaf_index}`)
        }
        out.push(value)
      }
      if (page.nextFrom === null || page.leaves.length === 0) {
        break
      }
      from = page.nextFrom
    }
    return out
  }

  async schedule(req: ScheduleRequest): Promise<ScheduleResult> {
    const res = await fetch(this.url('/v1/relay/schedule'), {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      throw new RelayerError(`schedule failed with ${res.status}`)
    }
    return (await res.json()) as ScheduleResult
  }

  async status(jobId: string): Promise<JobStatus> {
    return this.getJson<JobStatus>(`/v1/relay/status/${jobId}`)
  }
}
