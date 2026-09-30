// Per-wallet local note store, keyed by owner address so switching wallets shows
// the right notes. The wallet remembers its own notes; incoming notes can also
// be discovered by scanning events and decrypting the encrypted_output.

import { FIELD } from "./config";

export interface Note {
  amount: string;
  blinding: string;
  d: string; // diversifier hex (11 bytes); "" = default
  commitment: string; // on-chain commitment hex; globally-unique note id
  leafIndex: number; // -1 until the NewCommitment index is known
  spent: boolean;
}

// Scoped per (pool, owner) so switching wallet or pool shows the right notes.
const key = (poolId: string, owner: string) => `shielded_notes_${poolId}_${owner}`;

export function loadNotes(poolId: string, owner: string): Note[] {
  try {
    return JSON.parse(localStorage.getItem(key(poolId, owner)) ?? "[]");
  } catch {
    return [];
  }
}

export function saveNotes(poolId: string, owner: string, notes: Note[]): void {
  localStorage.setItem(key(poolId, owner), JSON.stringify(notes));
}

export function addNote(poolId: string, owner: string, n: Note): void {
  const notes = loadNotes(poolId, owner);
  notes.push(n);
  saveNotes(poolId, owner, notes);
}

// Keyed on commitment, not blinding: a sender-chosen blinding could collide with
// one already stored and mark the wrong note spent. Commitments cannot collide.
export function markSpent(poolId: string, owner: string, commitment: string): void {
  const notes = loadNotes(poolId, owner);
  const note = notes.find((n) => n.commitment === commitment && !n.spent);
  if (note) note.spent = true;
  saveNotes(poolId, owner, notes);
}

export function balance(notes: Note[]): bigint {
  return notes.filter((n) => !n.spent).reduce((a, n) => a + BigInt(n.amount), 0n);
}

/** Fresh random blinding (CSPRNG, reduced into the field). Random not derived so
 * it cannot collide across devices or after a storage wipe. */
export function randomBlinding(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return BigInt("0x" + Buffer.from(b).toString("hex")) % FIELD;
}
