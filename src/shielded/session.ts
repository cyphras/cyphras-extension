// Session persistence. Seed phrase kept in localStorage so a reload keeps the
// wallet open; Lock clears it. Not safe for real value; encrypt the seed under
// a password or use a hardware signer for that.
const SEED_KEY = "shielded_seed";
const ACTIVE_KEY = "shielded_account"; // which account index is open
const COUNT_KEY = "shielded_account_count"; // how many accounts the user added

export function saveSeed(mnemonic: string): void {
  localStorage.setItem(SEED_KEY, mnemonic);
}

export function loadSeed(): string | null {
  return localStorage.getItem(SEED_KEY);
}

export function saveActiveAccount(account: number): void {
  localStorage.setItem(ACTIVE_KEY, String(account));
}

export function loadActiveAccount(): number {
  return Math.max(0, Math.floor(Number(localStorage.getItem(ACTIVE_KEY) ?? 0)) || 0);
}

export function saveAccountCount(count: number): void {
  localStorage.setItem(COUNT_KEY, String(count));
}

// Clamp so a corrupted value cannot render an unbounded or fractional list.
const MAX_ACCOUNTS = 256;

export function loadAccountCount(): number {
  const n = Math.floor(Number(localStorage.getItem(COUNT_KEY) ?? 1)) || 1;
  return Math.min(Math.max(1, n), MAX_ACCOUNTS);
}

const POOL_KEY = "shielded_pool"; // selected pool (asset)

export function saveActivePool(id: string): void {
  localStorage.setItem(POOL_KEY, id);
}

export function loadActivePool(): string {
  return localStorage.getItem(POOL_KEY) ?? "xlm";
}

export function clearSession(): void {
  localStorage.removeItem(SEED_KEY);
  localStorage.removeItem(ACTIVE_KEY);
  localStorage.removeItem(COUNT_KEY);
  localStorage.removeItem(POOL_KEY);
}
