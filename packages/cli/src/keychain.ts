import type { SecretStorageBackend } from '../../../vendor/cross-keychain/index.js';
import type { TokenStore } from './types.js';
import { assertSecretServiceSession } from './session.js';

export const KEYCHAIN_SERVICE = 'cf-access';
const osBackends = new Set(['macos', 'windows', 'secret-service']);

/** Adapt a captured backend, never silently falling back to file or null storage. */
export function keychainTokenStore(backend: Pick<SecretStorageBackend, 'id' | 'getPassword' | 'setPassword' | 'deletePassword'>): TokenStore {
  if (!osBackends.has(backend.id)) {
    throw new Error(`cross-keychain selected '${backend.id}'; cf-access requires a non-native OS keychain (native/file/null backends are disabled). Linux requires secret-tool (Debian/Ubuntu: libsecret-tools) and an active Secret Service session`);
  }
  return {
    get: account => backend.getPassword(KEYCHAIN_SERVICE, account),
    set: (account, token) => backend.setPassword(KEYCHAIN_SERVICE, account, token),
    delete: async account => {
      // Upstream deletion throws when a credential is absent. Do not swallow real keychain failures.
      if (await backend.getPassword(KEYCHAIN_SERVICE, account) !== null) {
        await backend.deletePassword(KEYCHAIN_SERVICE, account);
      }
    },
  };
}

export async function createKeychainStore(): Promise<TokenStore> {
  await assertSecretServiceSession();
  const { getKeyring, initBackend } = await import('../../../vendor/cross-keychain/index.js');
  // Restrict selection itself, so a native backend cannot mask Secret Service.
  await initBackend(backend => osBackends.has(backend.id));
  return keychainTokenStore(await getKeyring());
}
