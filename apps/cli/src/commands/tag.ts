import { Command } from 'commander';
import { workspaceManager, ResourcesManager } from '@learn/core';
import chalk from 'chalk';

interface TagOptions {
  workspace?: string;
}

async function action(source: string, tagSpecs: string[], options: TagOptions, command: Command): Promise<void> {
  try {
    // Get raw args to handle -tag patterns that Commander may misinterpret
    const rawArgs = process.argv.slice(process.argv.indexOf('tag') + 1);

    // Extract workspace option if present
    let workspace = options.workspace;
    const workspaceIndex = rawArgs.indexOf('-w');
    const workspaceLongIndex = rawArgs.indexOf('--workspace');

    if (workspaceIndex !== -1 && workspaceIndex + 1 < rawArgs.length) {
      workspace = rawArgs[workspaceIndex + 1];
    } else if (workspaceLongIndex !== -1 && workspaceLongIndex + 1 < rawArgs.length) {
      workspace = rawArgs[workspaceLongIndex + 1];
    }

    // Filter out source, -w/--workspace and its value from raw args to get tag specs
    const tagSpecsRaw = rawArgs.filter((arg, i, arr) => {
      if (arg === source) return false;
      if (arg === '-w' || arg === '--workspace') return false;
      if (i > 0 && (arr[i - 1] === '-w' || arr[i - 1] === '--workspace')) return false;
      return true;
    });

    if (tagSpecsRaw.length === 0) {
      throw new Error('No tag operations specified. Use +tag to add or -tag to remove');
    }

    let workspacePath: string | null = null;

    if (workspace) {
      workspacePath = await workspaceManager.getWorkspacePath(workspace);
      if (!workspaceManager.isWorkspace(workspacePath)) {
        throw new Error(`Workspace "${workspace}" does not exist`);
      }
    } else {
      workspacePath = workspaceManager.getCurrentWorkspace();

      if (!workspacePath) {
        const workspaces = await workspaceManager.list();
        if (workspaces.length === 0) {
          throw new Error(
            'No workspace found. Create one first with: learn new <name>'
          );
        }

        if (workspaces.length === 1) {
          workspacePath = await workspaceManager.getWorkspacePath(workspaces[0]);
          console.log(
            chalk.gray(`Using workspace: ${chalk.cyan(workspaces[0])}`)
          );
        } else {
          throw new Error(
            `Multiple workspaces found. Please specify one with: learn tag <source> [tags...] --workspace <name>\n\n` +
              `Available workspaces:\n${workspaces.map((w) => `  - ${w}`).join('\n')}`
          );
        }
      }
    }

    const tagsToAdd: string[] = [];
    const tagsToRemove: string[] = [];

    for (const spec of tagSpecsRaw) {
      if (spec.startsWith('+')) {
        const tag = spec.slice(1);
        if (tag) {
          tagsToAdd.push(tag);
        }
      } else if (spec.startsWith('-')) {
        const tag = spec.slice(1);
        if (tag) {
          tagsToRemove.push(tag);
        }
      } else {
        throw new Error(`Invalid tag spec: "${spec}". Use +tag to add or -tag to remove`);
      }
    }

    ResourcesManager.updateTags(workspacePath, source, tagsToAdd, tagsToRemove);

    console.log(chalk.green(`✓ Tags updated for: ${source}`));
    if (tagsToAdd.length > 0) {
      console.log(chalk.gray(`  Added: ${tagsToAdd.map((t) => chalk.cyan(t)).join(', ')}`));
    }
    if (tagsToRemove.length > 0) {
      console.log(chalk.gray(`  Removed: ${tagsToRemove.map((t) => chalk.cyan(t)).join(', ')}`));
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('Error: ') + error.message);
      process.exit(1);
    }
    throw error;
  }
}

export const tagCommand = new Command('tag')
  .description('Add or remove tags on a resource')
  .argument('<source>', 'source identifier of the resource')
  .argument('<tags...>', 'tag operations: +tag to add, -tag to remove')
  .option('-w, --workspace <name>', 'target workspace')
  .passThroughOptions()
  .allowUnknownOption()
  .action(action);
