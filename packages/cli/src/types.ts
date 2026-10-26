/** Credential storage; defaults to the OS keychain via cross-keychain. */
export interface TokenStore {
  get(account: string): Promise<string | null>;
  set(account: string, token: string): Promise<void>;
  delete(account: string): Promise<void>;
}

export interface LoginOptions {
  /** Non-secret JWKS cache and process-lock directory; never used for tokens. */
  cacheDir?: string;
  tokenStore?: TokenStore;
  autoClose?: boolean;
  fedramp?: boolean;
  signal?: AbortSignal;
  onMessage?: (message: string) => void;
  fetch?: typeof fetch;
}

export interface AppInfo {
  authDomain: string;
  appAud: string;
  appHostname: string;
}

export interface MetadataClaims {
  type: string;
  hostname: string;
  auth_domain: string;
  aud: string;
  app_hostname?: string;
  iat: number;
}
