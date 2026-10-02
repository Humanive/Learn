import { Command } from 'commander';
import { workspaceManager, ResourcesManager } from '@learn/core';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';

interface RmOptions {
  workspace?: string;
  purge?: boolean;
}

async function action(source: string, options: RmOptions): Promise<void> {
  try {
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
            `Multiple workspaces found. Please specify one with: learn rm <source> --workspace <name>\n\n` +
              `Available workspaces:\n${workspaces.map((w) => `  - ${w}`).join('\n')}`
          );
        }
      }
    }

    const outputPath = ResourcesManager.removeResource(workspacePath, source);

    if (options.purge && outputPath) {
      const fullOutputPath = path.join(workspacePath, outputPath);
      if (fs.existsSync(fullOutputPath)) {
        const stats = fs.statSync(fullOutputPath);
        if (stats.isDirectory()) {
          fs.rmSync(fullOutputPath, { recursive: true, force: true });
          console.log(chalk.gray(`Deleted directory: ${chalk.cyan(outputPath)}`));
        } else {
          fs.unlinkSync(fullOutputPath);
          console.log(chalk.gray(`Deleted file: ${chalk.cyan(outputPath)}`));
        }
      } else {
        console.log(chalk.yellow(`Output not found: ${outputPath}`));
      }
    }

    console.log(chalk.green(`✓ Resource removed: ${source}`));
    if (outputPath && !options.purge) {
      console.log(chalk.gray(`  Output kept: ${outputPath}`));
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('Error: ') + error.message);
      process.exit(1);
    }
    throw error;
  }
}

export const rmCommand = new Command('rm')
  .description('Remove a resource from the workspace')
  .argument('<source>', 'source identifier of the resource to remove')
  .option('-w, --workspace <name>', 'target workspace')
  .option('-p, --purge', 'also delete the output file/folder')
  .action(action);
