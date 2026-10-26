#!/usr/bin/env node
import { createCLI } from './cli.js';

const cli = createCLI();
if (process.argv.length <= 2) {
  cli.outputHelp();
} else {
  cli.parseAsync().catch((error: unknown) => {
    process.stderr.write(`cf-access: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
