#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { RESERVED_WORKSPACE_NAMES } from '@humanive/learn-core';
import { newCommand } from './commands/new.js';
import { addCommand } from './commands/add.js';
import { listCommand } from './commands/list.js';
import { rmCommand } from './commands/rm.js';
import { tagCommand } from './commands/tag.js';
import { ingestCommand } from './commands/ingest.js';
import { workspaceListCommand } from './commands/workspace-list.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const program = new Command();

program
  .name('learn')
  .description('CLI tool for organizing learning materials')
  .version(version);

program.addCommand(newCommand);
program.addCommand(addCommand);
program.addCommand(listCommand);
program.addCommand(rmCommand);
program.addCommand(tagCommand);
program.addCommand(ingestCommand);

// A workspace prefix selects its command scope; reserved names keep top-level commands unambiguous.
const args = process.argv.slice(2);
const [first] = args;
const isWorkspaceScope =
  first !== undefined &&
  !first.startsWith('-') &&
  !(RESERVED_WORKSPACE_NAMES as readonly string[]).includes(first);

if (isWorkspaceScope) {
  const scopedProgram = new Command();
  scopedProgram
    .name(`learn ${first}`)
    .description(`Commands scoped to the "${first}" workspace`)
    .version(version);
  scopedProgram.addCommand(workspaceListCommand(first));
  scopedProgram.parse([process.argv[0], process.argv[1], ...args.slice(1)]);
} else {
  program.parse();
}
