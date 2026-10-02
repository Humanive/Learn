import { Command } from 'commander';
import { spawn } from 'child_process';
import { workspaceManager, configManager, ResourcesManager } from '@learn/core';
import { ingestWorkspace, IngestConfig, AgentHandoff } from '@learn/core';
import chalk from 'chalk';

interface IngestOptions {
  workspace?: string;
  agent?: string;
}

const AGENT_COMMANDS: Record<string, { command: string; args: (prompt: string) => string[] }> = {
  claude: { command: 'claude', args: (prompt) => ['-p', prompt] },
  codex: { command: 'codex', args: (prompt) => ['exec', '--full-auto', prompt] },
  pi: { command: 'pi', args: (prompt) => ['-p', prompt] },
};

const AGENT_TIMEOUT = 300000;

function createAgentRunner(agentName: string, timeoutMs: number) {
  const agent = AGENT_COMMANDS[agentName];
  if (!agent) {
    throw new Error(`Unknown agent "${agentName}". Choose one of: ${Object.keys(AGENT_COMMANDS).join(', ')}`);
  }

  return (handoff: AgentHandoff): Promise<void> => new Promise((resolve, reject) => {
    const prompt = [
      `Read ${handoff.manifestPath}.`,
      'Process every resource you can and write each result to its exact expected output path in the workspace.',
      'Keep resources you cannot process untouched and do not edit resources.json.',
    ].join(' ');
    const child = spawn(agent.command, agent.args(prompt), {
      cwd: handoff.workspacePath,
      stdio: 'inherit',
      shell: false,
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`${agent.command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${agent.command} exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
      }
    });
  });
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
      agentTimeout: AGENT_TIMEOUT,
      globalConfig,
      agentName: options.agent || globalConfig.agent,
      agentRunner: options.agent || globalConfig.agent
        ? createAgentRunner(options.agent || globalConfig.agent!, AGENT_TIMEOUT)
        : undefined,
    };

    // Process resources
    const result = await ingestWorkspace(workspacePath, config);

    // Show results
    console.log();
    console.log(chalk.bold('Ingest Summary:'));
    console.log(chalk.green(`  ✓ Succeeded: ${result.success}`));
    console.log(chalk.red(`  ✗ Failed: ${result.failed}`));
    console.log(chalk.gray(`  ⊘ Skipped: ${result.skipped}`));
    if (result.handedOff > 0) {
      console.log(chalk.blue(`  ↪ Handed off: ${result.handedOff}`));
    }

    if (result.failed > 0) {
      console.log();
      console.log(chalk.yellow('Some resources failed to ingest. Check their status with: learn list'));
      console.log(chalk.gray('See .learn/failed-resources.md to retry the external handoff.'));
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
  .option('-a, --agent <name>', 'external agent for failed resources (claude, codex, pi)')
  .action(action);
