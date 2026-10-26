import type { TokenStore } from '../src/types.js';

export class MemoryTokenStore implements TokenStore {
  readonly values = new Map<string, string>();
  readonly deleted: string[] = [];
  async get(account: string): Promise<string | null> { return this.values.get(account) ?? null; }
  async set(account: string, token: string): Promise<void> { this.values.set(account, token); }
  async delete(account: string): Promise<void> { this.deleted.push(account); this.values.delete(account); }
}
