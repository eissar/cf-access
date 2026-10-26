import type { LoginOptions } from './types.js';

export function fetcher(options: LoginOptions): typeof fetch {
  return options.fetch ?? fetch;
}

export async function request(input: RequestInfo | URL, init: RequestInit, options: LoginOptions, timeoutMs = 10_000): Promise<Response> {
  // Keep the timeout attached through response-body consumption, not just headers.
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  signal.throwIfAborted();
  const headers = new Headers(init.headers);
  if (!headers.has('user-agent')) headers.set('user-agent', 'cloudflared/cf-access-typescript');
  return fetcher(options)(input, { ...init, headers, signal, redirect: 'manual' });
}

export function message(options: LoginOptions, value: string): void {
  options.onMessage?.(value);
}
