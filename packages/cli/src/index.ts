#!/usr/bin/env node
import { createCLI } from './cli.js';

createCLI().parseAsync().catch((error: unknown) => {
  process.stderr.write(`cf-access: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
