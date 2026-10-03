#!/usr/bin/env node
import { Command } from 'commander';
import { RESERVED_WORKSPACE_NAMES } from '@learn/core';
import { newCommand } from './commands/new.js';
import { addCommand } from './commands/add.js';
import { listCommand } from './commands/list.js';
import { rmCommand } from './commands/rm.js';
import { tagCommand } from './commands/tag.js';
import { ingestCommand } from './commands/ingest.js';
import { workspaceListCommand } from './commands/workspace-list.js';

const program = new Command();

program
  .name('learn')
  .description('CLI tool for organizing learning materials')
  .version('0.1.0');

program.addCommand(newCommand);
program.addCommand(addCommand);
program.addCommand(listCommand);
program.addCommand(rmCommand);
program.addCommand(tagCommand);
program.addCommand(ingestCommand);

/**
 * `learn <workspace> list` is a workspace-scoped command: the first argument
 * names a workspace instead of a top-level command. Reserved workspace names
 * are rejected on creation, so this dispatch stays deterministic.
 */
const args = process.argv.slice(2);
const [first] = args;
const isWorkspaceScope =
  first !== undefined &&
  !first.startsWith('-') &&
  !(RESERVED_WORKSPACE_NAMES as readonly string[]).includes(first);

if (isWorkspaceScope) {
  // A separate program instance: the scoped `list` would otherwise collide
  // with the workspace index `list` registered above.
  const scopedProgram = new Command();
  scopedProgram
    .name(`learn ${first}`)
    .description(`Commands scoped to the "${first}" workspace`)
    .version('0.1.0');
  scopedProgram.addCommand(workspaceListCommand(first));
  scopedProgram.parse([process.argv[0], process.argv[1], ...args.slice(1)]);
} else {
  program.parse();
}
