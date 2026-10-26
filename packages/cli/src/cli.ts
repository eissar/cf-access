import { Command } from 'commander';
import { login } from './client.js';

export function createCLI(): Command {
  const program = new Command().name('cf-access').description('Log in to a Cloudflare Access application').version('0.1.0');
  program.command('login [url]')
    .description('Authenticate in your browser and print an application JWT')
    .option('--app <url>', 'Application URL (alternative to positional URL)')
    .option('--cache-dir <path>', 'Public JWKS cache and lock directory (tokens use OS keychain)')
    .option('--auto-close', 'Ask Access to close the browser interstitial')
    .option('--fedramp', 'Use the FedRAMP transfer relay')
    .option('--quiet', 'Suppress token output (login instructions still use stderr)')
    .option('--no-verbose', 'Print only the JWT, without a success message')
    .action(async (url: string | undefined, flags: { app?: string; cacheDir?: string; autoClose?: boolean; fedramp?: boolean; quiet?: boolean; verbose: boolean }) => {
      const input = url ?? flags.app;
      if (!input) throw new Error('provide an application URL or --app <url>');
      const controller = new AbortController();
      const abort = () => controller.abort(new Error('authentication interrupted'));
      process.once('SIGINT', abort);
      process.once('SIGTERM', abort);
      try {
        const token = await login(input, {
          cacheDir: flags.cacheDir,
          autoClose: flags.autoClose, fedramp: flags.fedramp,
          signal: controller.signal,
          onMessage: message => process.stderr.write(message + '\n'),
        });
        if (!flags.quiet) process.stdout.write(flags.verbose && !flags.app ? `Successfully fetched your token:\n\n${token}\n\n` : token);
      } finally {
        process.removeListener('SIGINT', abort);
        process.removeListener('SIGTERM', abort);
      }
    });
  return program;
}
