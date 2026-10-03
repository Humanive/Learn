import { Command } from 'commander';
import { workspaceManager, ResourcesManager } from '@learn/core';
import * as path from 'path';
import chalk from 'chalk';

interface ListOptions {
  json?: boolean;
}

async function action(options: ListOptions): Promise<void> {
  try {
    const workspaces = await workspaceManager.list();

    if (options.json) {
      console.log(JSON.stringify(workspaces));
      return;
    }

    if (workspaces.length === 0) {
      console.log(chalk.yellow('No workspaces found.'));
      console.log(chalk.gray('\nCreate one with: ') + chalk.cyan('learn new <name>'));
      return;
    }

    console.log(chalk.bold('\nLearning Workspaces:\n'));

    for (const workspace of workspaces) {
      const workspacePath = await workspaceManager.getWorkspacePath(workspace);
      const counts = ResourcesManager.getCounts(workspacePath);

      console.log(chalk.cyan(`  ${workspace}`));
      console.log(chalk.gray(`    Resources: ${counts.total} (${counts.pending} pending)`));
      console.log();
    }

    const currentWorkspace = workspaceManager.getCurrentWorkspace();
    if (currentWorkspace) {
      console.log(chalk.gray(`Current workspace: ${chalk.cyan(path.basename(currentWorkspace))}`));
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('Error: ') + error.message);
      process.exit(1);
    }
    throw error;
  }
}

export const listCommand = new Command('list')
  .alias('ls')
  .description('List all learning workspaces')
  .option('--json', 'print workspace names as JSON')
  .action(action);
