import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

export function tokenPath(dir: string, kind: 'app' | 'org', key: string): string {
  return join(dir, `${kind}-${createHash('sha256').update(key).digest('hex')}.token`);
}

export function tokenClaims(token: string): { exp?: number; aud?: string | string[] } | undefined {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return;
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as { exp?: number; aud?: string | string[] };
  } catch { return; }
}

export function validToken(token: string, audience?: string): boolean {
  const claims = tokenClaims(token);
  if (!claims || !Number.isFinite(claims.exp) || claims.exp! <= Math.floor(Date.now() / 1000)) return false;
  if (audience && !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(audience)) return false;
  return true;
}

export async function readToken(path: string, audience?: string): Promise<string | undefined> {
  try {
    const token = (await readFile(path, 'utf8')).trim();
    if (validToken(token, audience)) return token;
    await rm(path, { force: true });
  } catch { /* absent or unreadable */ }
  return undefined;
}

export async function writeToken(path: string, token: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${token}\n`, { mode: 0o600 });
  await rename(temp, path);
}

// Exclusive-create lock. Stale locks are reclaimed only after 10 minutes; this protocol is local to this TS client.
export async function withLock<T>(path: string, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`;
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const deadline = Date.now() + 600_000;
  for (;;) {
    if (signal?.aborted) throw signal.reason ?? new Error('aborted');
    try {
      const handle = await open(lock, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, id, at: Date.now() }));
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try { if (Date.now() - (await stat(lock)).mtimeMs > 600_000) await rm(lock, { force: true }); } catch { /* raced */ }
      if (Date.now() >= deadline) throw new Error('timed out waiting for token lock');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  try { return await work(); }
  finally {
    try {
      const body = JSON.parse(await readFile(lock, 'utf8')) as { id?: string };
      if (body.id === id) await rm(lock, { force: true });
    } catch { /* already removed */ }
  }
}
