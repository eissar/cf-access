import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const guidance = 'Run from a session with a working D-Bus connection and an available Secret Service keyring. If using a long-lived terminal/server, refresh its session environment.';

interface SessionCheckOptions {
  platform?: NodeJS.Platform;
  address?: string;
  probe?: (address: string) => Promise<void>;
}

async function probeSecretService(address: string): Promise<void> {
  await execute('dbus-send', [
    `--bus=${address}`,
    '--print-reply',
    '--reply-timeout=3000',
    '--dest=org.freedesktop.secrets',
    '/org/freedesktop/secrets',
    'org.freedesktop.DBus.Peer.Ping',
  ], { timeout: 5000, maxBuffer: 64 * 1024 });
}

/** Check only; never discover another bus, rewrite the environment or create a private session. */
export async function assertSecretServiceSession(options: SessionCheckOptions = {}): Promise<void> {
  if ((options.platform ?? process.platform) !== 'linux') return;
  const address = options.address ?? process.env.DBUS_SESSION_BUS_ADDRESS;
  if (!address?.trim()) {
    throw new Error(`DBUS_SESSION_BUS_ADDRESS is missing. ${guidance}`);
  }
  try {
    await (options.probe ?? probeSecretService)(address);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Linux keychain checks require dbus-send (Debian/Ubuntu/Devuan: install dbus-bin).');
    }
    throw new Error(`Cannot reach Secret Service through the configured D-Bus session. ${guidance}`);
  }
}
