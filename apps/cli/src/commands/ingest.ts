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
  claude: { command: 'claude', args: (prompt) => ['-p', '--permission-mode', 'acceptEdits', prompt] },
  codex: { command: 'codex', args: (prompt) => ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', prompt] },
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
    if (handoff.signal?.aborted) {
      reject(new Error('Agent handoff cancelled'));
      return;
    }
    const grouped = process.platform !== 'win32';
    const child = spawn(agent.command, agent.args(prompt), {
      cwd: handoff.workspacePath,
      stdio: 'inherit',
      shell: false,
      detached: grouped,
    });

    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const interruptHandler = () => {
      process.exitCode = 130;
      terminate();
    };
    const terminationHandler = () => {
      process.exitCode = 143;
      terminate();
    };
    const cleanup = () => {
      handoff.signal?.removeEventListener('abort', terminate);
      process.removeListener('SIGINT', interruptHandler);
      process.removeListener('SIGTERM', terminationHandler);
    };
    const terminate = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (grouped && child.pid) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
            console.warn(`Unable to stop ${agent.command}: ${(error as Error).message}`);
          }
        }
      };
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 1000);
      reject(new Error(`${agent.command} handoff cancelled or timed out after ${timeoutMs}ms`));
    };
    const timer = setTimeout(terminate, timeoutMs);
    handoff.signal?.addEventListener('abort', terminate, { once: true });
    process.once('SIGINT', interruptHandler);
    process.once('SIGTERM', terminationHandler);

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (killTimer && !grouped) clearTimeout(killTimer);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
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
    const globalConfig = await configManager.load();
    const agentName = options.agent || globalConfig.agent;
    const failedCount = agentName
      ? ResourcesManager.load(workspacePath).resources.filter(resource => resource.status === 'failed').length
      : 0;

    if (counts.pending === 0 && failedCount === 0) {
      console.log(chalk.yellow('No pending resources to ingest'));
      return;
    }

    console.log(chalk.cyan(`Ingesting ${counts.pending} pending resource(s)...\n`));
    if (failedCount > 0) {
      console.log(chalk.cyan(`Handing ${failedCount} previously failed resource(s) to ${agentName}...\n`));
    }

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
      agentName,
      agentRunner: agentName
        ? createAgentRunner(agentName, AGENT_TIMEOUT)
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
