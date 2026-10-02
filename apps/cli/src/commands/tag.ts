import { Command } from 'commander';
import { workspaceManager, ResourcesManager } from '@learn/core';
import chalk from 'chalk';

interface TagOptions {
  workspace?: string;
}

async function action(source: string, tagSpecs: string[], options: TagOptions, command: Command): Promise<void> {
  try {
    // Commander.js parses -tag as option, so we need to get raw args after source
    const rawArgs = command.args.slice(1); // Skip source, get the rest

    if (rawArgs.length === 0) {
      throw new Error('No tag operations specified. Use +tag to add or -tag to remove');
    }

    let workspacePath: string | null = null;

    if (options.workspace) {
      workspacePath = await workspaceManager.getWorkspacePath(options.workspace);
      if (!workspaceManager.isWorkspace(workspacePath)) {
        throw new Error(`Workspace "${options.workspace}" does not exist`);
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

    for (const spec of rawArgs) {
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
