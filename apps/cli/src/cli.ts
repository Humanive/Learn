#!/usr/bin/env node
import { Command } from 'commander';
import { newCommand } from './commands/new.js';
import { addCommand } from './commands/add.js';
import { listCommand } from './commands/list.js';
import { rmCommand } from './commands/rm.js';
import { tagCommand } from './commands/tag.js';

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

program.parse();
