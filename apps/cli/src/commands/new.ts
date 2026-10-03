import { Command } from 'commander';
import { workspaceManager } from '@humanive/learn-core';
import chalk from 'chalk';

async function action(name: string): Promise<void> {
  try {
    console.log(chalk.blue(`Creating workspace "${name}"...`));

    const workspacePath = await workspaceManager.create(name);

    console.log(chalk.green('✓ Workspace created successfully!'));
    console.log(chalk.gray(`\nLocation: ${workspacePath}`));
    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.gray('  1. Add resources: ') + chalk.cyan(`learn add <url> -t tag1,tag2`));
    console.log(chalk.gray('  2. Open workspace: ') + chalk.cyan(`cd ${name}`));
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('Error: ') + error.message);
      process.exit(1);
    }
    throw error;
  }
}

export const newCommand = new Command('new')
  .description('Create a new learning workspace')
  .argument('<name>', 'workspace name')
  .action(action);
