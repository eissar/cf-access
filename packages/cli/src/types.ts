export interface LoginOptions {
  cacheDir?: string;
  noBrowser?: boolean;
  autoClose?: boolean;
  fedramp?: boolean;
  signal?: AbortSignal;
  onMessage?: (message: string) => void;
  openBrowser?: (url: string) => Promise<void>;
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
