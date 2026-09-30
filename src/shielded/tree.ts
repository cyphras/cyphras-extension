// In-browser Merkle tree: fetch the vault NewCommitment events, rebuild the tree
// with the same parity-verified Poseidon2 the contract uses, and serve the
// current root plus a leaf path so the wallet can spend a note.
import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import * as snarkjs from "snarkjs";
import { RPC_URL, type Pool } from "./config";
import { circuitBase } from "./poseidon2";

const server = new rpc.Server(RPC_URL);
const DEPTH = 20;

async function hashPair(left: bigint, right: bigint): Promise<bigint> {
  const wtns: { type: string } = { type: "mem" };
  await snarkjs.wtns.calculate(
    { inputs: [left.toString(), right.toString()] },
    `${circuitBase()}/poseidon2_compress_main.wasm`,
    wtns,
  );
  return (await snarkjs.wtns.exportJson(wtns) as bigint[])[1];
}

let zerosCache: bigint[] | null = null;
async function zeros(): Promise<bigint[]> {
  if (zerosCache) return zerosCache;
  const z = [0n];
  for (let i = 1; i < DEPTH; i++) z.push(await hashPair(z[i - 1], z[i - 1]));
  zerosCache = z;
  return z;
}

export interface Commitment {
  leafIndex: number;
  value: bigint;
}

// Public RPC caps the ledger span per getEvents query, so scan forward in fixed
// windows up to the latest ledger.
const WINDOW = 9_000;
const SCAN_BACK = 60_000;

/** All commitments in insertion order. Prefers the indexer (durable, complete);
 * falls back to scanning RPC events. The indexer is trusted only when /health
 * reports ready, since a gapped or lagging indexer still serves /notes with a
 * partial leaf set. */
export async function fetchCommitments(pool: Pool): Promise<Commitment[]> {
  try {
    const health = await fetch(`${pool.indexerUrl}/health`, { signal: AbortSignal.timeout(2500) });
    if (health.ok) {
      const res = await fetch(`${pool.indexerUrl}/notes?since=0`, { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        const rows = (await res.json()) as { leaf_index: string; commitment: string }[];
        return rows
          .map((r) => ({ leafIndex: Number(r.leaf_index), value: BigInt("0x" + r.commitment) }))
          .sort((a, b) => a.leafIndex - b.leafIndex);
      }
    }
    // health 503 or notes error: do not trust a partial view; fall through to RPC
  } catch {
    // indexer unavailable; fall back to RPC scan below
  }
  return fetchCommitmentsFromRpc(pool);
}

async function fetchCommitmentsFromRpc(pool: Pool): Promise<Commitment[]> {
  const latest = (await server.getLatestLedger()).sequence;
  const out: Commitment[] = [];
  let from = Math.max(latest - SCAN_BACK, 1);
  const filters = [{ type: "contract" as const, contractIds: [pool.vaultId] }];
  while (from <= latest) {
    let cursor: string | undefined;
    for (;;) {
      // surface fetch errors: a swallowed window drops events and a dropped tail
      // builds a stale root that passes the contiguity guard
      const res = await server.getEvents(
        cursor ? { filters, limit: 200, cursor } : { filters, limit: 200, startLedger: from },
      );
      for (const e of res.events) {
        if ((scValToNative(e.topic[0] as xdr.ScVal) as string) === "new_commitment") {
          const d = scValToNative(e.value as xdr.ScVal) as { index: number; commitment: bigint };
          out.push({ leafIndex: Number(d.index), value: BigInt(d.commitment) });
        }
      }
      if (res.events.length < 200) break;
      cursor = res.cursor;
    }
    from += WINDOW;
  }
  // windows can overlap; dedupe and order by leaf index
  const seen = new Set<number>();
  const commitments = out
    .filter((c) => (seen.has(c.leafIndex) ? false : (seen.add(c.leafIndex), true)))
    .sort((a, b) => a.leafIndex - b.leafIndex);
  // a non-contiguous leaf reads a missing left sibling and yields a wrong root
  assertContiguousFromZero(commitments);
  return commitments;
}

// leaves must run 0,1,2,... with no gap; any break means the indexer is required
function assertContiguousFromZero(commitments: Commitment[]): void {
  for (let i = 0; i < commitments.length; i++) {
    if (commitments[i].leafIndex !== i) {
      throw new Error(
        `indexer unavailable / incomplete history: commitment leaf ${commitments[i].leafIndex} ` +
          `is not contiguous from 0 (expected ${i}). Cannot rebuild the Merkle tree from RPC; ` +
          `the indexer is required for this pool.`,
      );
    }
  }
}

/** Build the tree from commitments; returns a node lookup plus the current root. */
async function buildTree(commitments: Commitment[]) {
  const z = await zeros();
  const nodes = new Map<string, bigint>(); // `${level}:${idx}`
  const get = (level: number, idx: bigint) => nodes.get(`${level}:${idx}`) ?? z[level];
  let root = await hashPair(z[DEPTH - 1], z[DEPTH - 1]);
  for (const c of commitments) {
    let idx = BigInt(c.leafIndex);
    let cur = c.value;
    nodes.set(`0:${idx}`, cur);
    for (let level = 0; level < DEPTH; level++) {
      if (idx % 2n === 0n) cur = await hashPair(cur, get(level, idx + 1n));
      else cur = await hashPair(get(level, idx - 1n), cur);
      idx /= 2n;
      nodes.set(`${level + 1}:${idx}`, cur);
    }
    root = cur;
  }
  return { get, root };
}

export interface SpendPath {
  root: bigint;
  pathElements: bigint[];
  pathIndices: bigint; // bits: 0 = node is left at that level
}

function pathOf(get: (level: number, idx: bigint) => bigint, leafIndex: number): { pathElements: bigint[]; pathIndices: bigint } {
  const path: bigint[] = [];
  let idx = BigInt(leafIndex);
  let indices = 0n;
  for (let level = 0; level < DEPTH; level++) {
    const isLeft = idx % 2n === 0n;
    path.push(get(level, isLeft ? idx + 1n : idx - 1n));
    if (!isLeft) indices |= 1n << BigInt(level);
    idx /= 2n;
  }
  return { pathElements: path, pathIndices: indices };
}

/** Current root plus the Merkle path for `leafIndex`, for spending that note. */
export async function spendPath(pool: Pool, leafIndex: number): Promise<SpendPath> {
  const { get, root } = await buildTree(await fetchCommitments(pool));
  return { root, ...pathOf(get, leafIndex) };
}

/** Paths for several leaves against one shared root, so a multi-input spend
 * proves every input against the same tree state. */
export async function spendPaths(pool: Pool, leafIndices: number[]): Promise<{ root: bigint; paths: { pathElements: bigint[]; pathIndices: bigint }[] }> {
  const { get, root } = await buildTree(await fetchCommitments(pool));
  return { root, paths: leafIndices.map((i) => pathOf(get, i)) };
}

export async function currentRoot(pool: Pool): Promise<bigint> {
  return (await buildTree(await fetchCommitments(pool))).root;
}
