import { spawn } from 'node:child_process';

export async function openBrowser(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('browser URL must use HTTPS');
  // Pass the URL as an argument, never interpolate it into a shell command.
  const [command, args] = process.platform === 'darwin'
    ? ['open', [url]] as const
    : process.platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] as const
      : ['xdg-open', [url]] as const;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: 'ignore', shell: false });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`browser launcher exited with code ${code}`)));
  });
}
