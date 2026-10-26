import nacl from 'tweetnacl';
import { message, request } from './http.js';
import type { LoginOptions } from './types.js';

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = (value: string) => new Uint8Array(Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));

export async function transfer(appUrl: URL, aud: string, options: LoginOptions): Promise<{ app_token: string; org_token: string }> {
  const pair = nacl.box.keyPair();
  const publicKey = b64url(pair.publicKey);
  const fedramp = options.fedramp || appUrl.hostname.toLowerCase().endsWith('.fed.cloudflareaccess.com');
  const base = fedramp ? 'https://login.fed.cloudflareaccess.org/' : 'https://login.cloudflareaccess.org/';
  const redirect = new URL(appUrl);
  redirect.searchParams.set('token', publicKey);
  redirect.searchParams.set('aud', aud);
  const browser = new URL(appUrl);
  browser.pathname = '/cdn-cgi/access/cli';
  browser.searchParams.set('token', publicKey);
  browser.searchParams.set('aud', aud);
  browser.searchParams.set('redirect_url', redirect.toString());
  browser.searchParams.set('send_org_token', 'true');
  browser.searchParams.set('edge_token_transfer', 'true');
  if (options.autoClose) browser.searchParams.set('close_interstitial', 'true');
  const url = browser.toString();
  message(options, `Open this URL to authenticate:\n${url}`);
  if (!options.noBrowser && options.openBrowser) {
    try { await options.openBrowser(url); } catch { message(options, `Could not launch browser. Open the URL manually:\n${url}`); }
  }
  const endpoint = `${base}transfer/${publicKey}`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await request(endpoint, { method: 'GET' }, options, 60_000);
    if (response.status >= 500) throw new Error(`transfer failed with HTTP ${response.status}`);
    if (response.status === 200) {
      const ciphertext = new Uint8Array(Buffer.from(await response.text(), 'base64'));
      const sender = fromB64url(response.headers.get('service-public-key') ?? '');
      if (sender.length !== nacl.box.publicKeyLength || ciphertext.length < nacl.box.nonceLength + nacl.box.overheadLength) throw new Error('invalid encrypted transfer response');
      const nonce = ciphertext.slice(0, nacl.box.nonceLength);
      const opened = nacl.box.open(ciphertext.slice(nacl.box.nonceLength), nonce, sender, pair.secretKey);
      if (!opened) throw new Error('unable to decrypt transfer response');
      const payload = JSON.parse(Buffer.from(opened).toString('utf8')) as { app_token?: string; org_token?: string };
      if (!payload.app_token || !payload.org_token) throw new Error('transfer response missing tokens');
      return { app_token: payload.app_token, org_token: payload.org_token };
    }
    message(options, 'Waiting for browser authentication…');
  }
  throw new Error('timed out waiting for transfer');
}
