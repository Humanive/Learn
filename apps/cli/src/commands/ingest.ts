import { Command } from 'commander';
import { workspaceManager, configManager, ResourcesManager } from '@learn/core';
import { ingestWorkspace, IngestConfig } from '@learn/core';
import chalk from 'chalk';

interface IngestOptions {
  workspace?: string;
}

async function action(options: IngestOptions): Promise<void> {
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
            `Multiple workspaces found. Please specify one with: learn ingest --workspace <name>\n\n` +
              `Available workspaces:\n${workspaces.map((w) => `  - ${w}`).join('\n')}`
          );
        }
      }
    }

    // Get counts before processing
    const counts = ResourcesManager.getCounts(workspacePath);

    if (counts.pending === 0) {
      console.log(chalk.yellow('No pending resources to ingest'));
      return;
    }

    console.log(chalk.cyan(`Ingesting ${counts.pending} pending resource(s)...\n`));

    // Load global config
    const globalConfig = await configManager.load();

    // Build ingest config
    const config: IngestConfig = {
      adapterChains: {
        web: ['jina'],
        pdf: ['markitdown'],
        repos: ['git'],
        local: ['local'],
        video: [],
      },
      concurrency: 3,
      agentTimeout: 300000, // 5 minutes
      globalConfig,
    };

    // Process resources
    const result = await ingestWorkspace(workspacePath, config);

    // Show results
    console.log();
    console.log(chalk.bold('Ingest Summary:'));
    console.log(chalk.green(`  ✓ Succeeded: ${result.success}`));
    console.log(chalk.red(`  ✗ Failed: ${result.failed}`));
    console.log(chalk.gray(`  ⊘ Skipped: ${result.skipped}`));

    if (result.failed > 0) {
      console.log();
      console.log(chalk.yellow('Some resources failed to ingest. Check their status with: learn list'));
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('Error: ') + error.message);
      process.exit(1);
    }
    throw error;
  }
}

export const ingestCommand = new Command('ingest')
  .description('Ingest all pending resources in the workspace')
  .option('-w, --workspace <name>', 'target workspace')
  .action(action);
