import { Command } from 'commander';
import { workspaceManager, ResourcesManager, ingestRouter } from '@learn/core';
import chalk from 'chalk';

interface AddOptions {
  tags?: string;
  workspace?: string;
}

async function action(source: string, options: AddOptions): Promise<void> {
  try {
    const tags = options.tags ? options.tags.split(',').map((t) => t.trim()) : [];
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
            `Multiple workspaces found. Please specify one with: learn add <source> --workspace <name>\n\n` +
              `Available workspaces:\n${workspaces.map((w) => `  - ${w}`).join('\n')}`
          );
        }
      }
    }

    const type = ingestRouter.detectType(source);
    console.log(chalk.gray(`Detected type: ${chalk.cyan(type)}`));

    ResourcesManager.addResource(workspacePath, source, type, tags);

    console.log(chalk.green('✓ Resource added to workspace'));
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('Error: ') + error.message);
      process.exit(1);
    }
    throw error;
  }
}

export const addCommand = new Command('add')
  .description('Add a resource to the workspace')
  .argument('<source>', 'URL, file path, or repository')
  .option('-t, --tags <tags>', 'comma-separated tags')
  .option('-w, --workspace <name>', 'target workspace')
  .action(action);
