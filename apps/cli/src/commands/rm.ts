import { Command } from 'commander';
import { workspaceManager, ResourcesManager } from '@humanive/learn-core';
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

    const resource = ResourcesManager.load(workspacePath).resources.find((entry) => entry.source === source);
    if (!resource) throw new Error(`Resource "${source}" not found`);
    const outputPath = resource.output;

    if (options.purge && outputPath) {
      const fullOutputPath = path.resolve(workspacePath, outputPath);
      const relativeOutput = path.relative(path.resolve(workspacePath), fullOutputPath);
      if (!relativeOutput || relativeOutput === '..' || relativeOutput.startsWith(`..${path.sep}`) || path.isAbsolute(relativeOutput)) {
        throw new Error('Refusing to delete output outside the workspace or the workspace itself');
      }
      let parent = path.dirname(fullOutputPath);
      while (!fs.existsSync(parent)) parent = path.dirname(parent);
      const realParent = fs.realpathSync(parent);
      const relativeParent = path.relative(fs.realpathSync(workspacePath), realParent);
      if (relativeParent === '..' || relativeParent.startsWith(`..${path.sep}`) || path.isAbsolute(relativeParent)) {
        throw new Error('Refusing to delete output outside the workspace through a symlink');
      }
      let stats: fs.Stats | undefined;
      try {
        stats = fs.lstatSync(fullOutputPath);
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      }
      if (stats) {
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
    ResourcesManager.removeResource(workspacePath, source);

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
  .option('-p, --purge', 'also delete workspace-contained output (rejects escaped paths)')
  .action(action);
