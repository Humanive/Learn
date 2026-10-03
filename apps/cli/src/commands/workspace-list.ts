import { Command } from 'commander';
import { workspaceManager, ResourcesManager } from '@learn/core';
import type { ResourceStatus, ResourceType } from '@learn/core';
import * as path from 'path';
import chalk from 'chalk';

const STATUSES: ResourceStatus[] = ['pending', 'ingested', 'failed'];
const TYPES: ResourceType[] = ['web', 'pdf', 'video', 'repos', 'local'];

interface WorkspaceListOptions {
  status: string[];
  type: string[];
  tag: string[];
  verbose?: boolean;
  json?: boolean;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function isUrl(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validate<T extends string>(flag: string, values: string[], allowed: T[]): T[] {
  for (const value of values) {
    if (!(allowed as string[]).includes(value)) {
      throw new Error(`Invalid ${flag} value "${value}". Valid values: ${allowed.join(', ')}`);
    }
  }
  return values as T[];
}

function describeFilters(options: WorkspaceListOptions): string[] {
  const parts: string[] = [];
  if (options.status.length > 0) parts.push(`--status ${options.status.join(', ')}`);
  if (options.type.length > 0) parts.push(`--type ${options.type.join(', ')}`);
  if (options.tag.length > 0) parts.push(`--tag ${options.tag.join(', ')}`);
  return parts;
}

async function action(workspaceName: string, options: WorkspaceListOptions): Promise<void> {
  try {
    const statuses = validate('--status', options.status, STATUSES);
    const types = validate('--type', options.type, TYPES);

    const workspacePath = await workspaceManager.getWorkspacePath(workspaceName);
    if (!workspaceManager.isWorkspace(workspacePath)) {
      throw new Error(
        `Workspace "${workspaceName}" does not exist. List available workspaces with: learn list`
      );
    }

    const all = ResourcesManager.load(workspacePath).resources;

    // AND across dimensions, OR (and case-sensitive) within one dimension
    const resources = all.filter(
      (resource) =>
        (statuses.length === 0 || statuses.includes(resource.status)) &&
        (types.length === 0 || types.includes(resource.type)) &&
        (options.tag.length === 0 || options.tag.some((tag) => resource.tags.includes(tag)))
    );

    if (options.json) {
      console.log(JSON.stringify({ workspace: workspaceName, path: workspacePath, resources }, null, 2));
      return;
    }

    if (all.length === 0) {
      console.log(chalk.yellow(`No resources in workspace "${workspaceName}".`));
      console.log(chalk.gray('Add one with: ') + chalk.cyan(`learn add <url> -w ${workspaceName}`));
      return;
    }

    if (resources.length === 0) {
      const filters = describeFilters(options);
      console.log(
        chalk.yellow(
          `No resources in "${workspaceName}" match ${filters.join(' ')} (${all.length} total).`
        )
      );
      return;
    }

    console.log(chalk.bold(`\nResources in ${workspaceName} (${resources.length}):\n`));

    console.log(chalk.gray(`  Workspace: ${workspacePath}\n`));

    resources.forEach((resource, index) => {
      const label = resource.title ?? resource.source;
      const sourceLabel = isUrl(resource.source) ? 'URL' : 'Path';

      console.log(
        `  ${index + 1}. [${resource.status}] ${label}  ${chalk.gray(resource.type)}`
      );
      console.log(`     ${chalk.gray(`${sourceLabel}:`.padEnd(9))} ${resource.source}`);

      if (resource.output) {
        const output = options.verbose
          ? path.resolve(workspacePath, resource.output)
          : resource.output;
        console.log(`     ${chalk.gray('Output:'.padEnd(9))} ${output}`);
      }

      if (options.verbose) {
        if (resource.title) {
          console.log(`     ${chalk.gray('Title:'.padEnd(9))} ${resource.title}`);
        }
        console.log(`     ${chalk.gray('Tags:'.padEnd(9))} ${resource.tags.join(', ') || '(none)'}`);
        if (resource.adapter) {
          console.log(`     ${chalk.gray('Adapter:'.padEnd(9))} ${resource.adapter}`);
        }
        if (resource.addedAt) {
          console.log(`     ${chalk.gray('Added:'.padEnd(9))} ${resource.addedAt}`);
        }
        if (resource.ingestedAt) {
          console.log(`     ${chalk.gray('Ingested:'.padEnd(9))} ${resource.ingestedAt}`);
        }
      }

      console.log();
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red('Error: ') + error.message);
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Build the `learn <workspace> list` command for a named workspace.
 * Commander keeps the workspace out of the argument list, so the command
 * reads exactly like its workspace index counterpart.
 */
export function workspaceListCommand(workspaceName: string): Command {
  return new Command('list')
    .alias('ls')
    .description(`List resources in workspace "${workspaceName}"`)
    .option(
      '--status <status>',
      `filter by status: ${STATUSES.join(', ')} (repeatable; OR within a dimension, AND across dimensions)`,
      collect,
      [] as string[]
    )
    .option('--type <type>', `filter by type: ${TYPES.join(', ')} (repeatable)`, collect, [] as string[])
    .option('--tag <tag>', 'filter by exact tag (repeatable)', collect, [] as string[])
    .option('-v, --verbose', 'show extended metadata and absolute paths')
    .option('--json', 'print workspace, path, and resources as JSON')
    .action((options: WorkspaceListOptions) => action(workspaceName, options));
}
