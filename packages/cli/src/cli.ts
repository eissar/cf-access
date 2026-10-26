import { Command } from 'commander';
import { login, status } from './client.js';

type Login = typeof login;

export function createCLI(authenticate: Login = login, inspect: typeof status = status): Command {
  const program = new Command().name('cf-access').description('Log in to a Cloudflare Access application').version('0.1.0');
  program.command('login [url]')
    .description('Authenticate and store credentials in the OS keychain')
    .option('--app <url>', 'Application URL (alternative to positional URL)')
    .option('--cache-dir <path>', 'Public JWKS cache and lock directory (tokens use OS keychain)')
    .option('--auto-close', 'Ask Access to close the browser interstitial')
    .option('--fedramp', 'Use the FedRAMP transfer relay')
    .option('--quiet', 'Suppress success output (login instructions still use stderr)')
    .action(async (url: string | undefined, flags: { app?: string; cacheDir?: string; autoClose?: boolean; fedramp?: boolean; quiet?: boolean }) => {
      const input = url ?? flags.app;
      if (!input) throw new Error('provide an application URL or --app <url>');
      const controller = new AbortController();
      const abort = () => controller.abort(new Error('authentication interrupted'));
      process.once('SIGINT', abort);
      process.once('SIGTERM', abort);
      try {
        await authenticate(input, {
          cacheDir: flags.cacheDir,
          autoClose: flags.autoClose, fedramp: flags.fedramp,
          signal: controller.signal,
          onMessage: message => process.stderr.write(message + '\n'),
        });
        if (!flags.quiet) process.stderr.write('Logged in. Credentials stored in the OS keychain.\n');
      } finally {
        process.removeListener('SIGINT', abort);
        process.removeListener('SIGTERM', abort);
      }
    });
  program.command('status [url]')
    .description('Inspect the application token in the OS keychain without logging in')
    .option('--app <url>', 'Application URL (alternative to positional URL)')
    .option('--cache-dir <path>', 'Public JWKS cache directory')
    .action(async (url: string | undefined, flags: { app?: string; cacheDir?: string }) => {
      const input = url ?? flags.app;
      if (!input) throw new Error('provide an application URL or --app <url>');
      const result = await inspect(input, { cacheDir: flags.cacheDir });
      process.stdout.write(`${result.hostname}: application token ${result.state}\n`);
      if (result.expiresAt) process.stdout.write(`Expires: ${result.expiresAt}\n`);
      if (result.state === 'valid') process.stdout.write('Local expiry/audience check only; not verified at edge.\n');
      else process.exitCode = 1;
    });
  return program;
}
