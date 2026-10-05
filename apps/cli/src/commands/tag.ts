import { Command } from 'commander';
import { workspaceManager, ResourcesManager } from '@humanive/learn-core';
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
    // Arguments after `--` are literal resource/tag operands, even when a
    // removal such as -w looks like the workspace option.
    const separatorIndex = rawArgs.indexOf('--');
    const optionArgs = separatorIndex === -1 ? rawArgs : rawArgs.slice(0, separatorIndex);
    const operands: string[] = [];
    for (let i = 0; i < optionArgs.length; i++) {
      const arg = optionArgs[i];
      if (arg === '-w' || arg === '--workspace') {
        workspace = optionArgs[++i];
      } else if (arg.startsWith('--workspace=')) {
        workspace = arg.slice('--workspace='.length);
      } else if (arg.startsWith('-w') && !arg.startsWith('--')) {
        workspace = arg.slice(2);
      } else {
        operands.push(arg);
      }
    }
    if (separatorIndex !== -1) operands.push(...rawArgs.slice(separatorIndex + 1));
    const tagSpecsRaw = operands.slice(1);

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
  .description('Add or remove tags on a resource. Use -- before literal resource/tag operands.')
  .argument('<source>', 'source identifier of the resource')
  .argument('<tags...>', 'tag operations: +tag to add, -tag to remove')
  .option('-w, --workspace <name>', 'target workspace')
  .passThroughOptions()
  .allowUnknownOption()
  .action(action);
