import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { AdapterContext, AdapterResult } from './types.js';

const execAsync = promisify(exec);

/**
 * Clone a Git repository to repos/<title>/
 */
export async function gitAdapter(context: AdapterContext): Promise<AdapterResult> {
  const { source, workspacePath, config } = context;

  // Check if git is available
  try {
    await execAsync('git --version');
  } catch (error) {
    return {
      success: false,
      reason: 'git command not found',
    };
  }

  // Extract repo name from URL
  const repoName = extractRepoName(source);
  if (!repoName) {
    return {
      success: false,
      reason: 'Could not extract repository name from URL',
    };
  }

  // Find unique output path
  const reposDir = path.join(workspacePath, 'repos');
  const outputPath = findUniqueRepoPath(reposDir, repoName);
  const relativePath = path.relative(workspacePath, outputPath);

  // Build git clone command
  const depth = config.defaultGitDepth || 1;
  const cloneCommand = `git clone --depth ${depth} "${source}" "${outputPath}"`;

  try {
    await execAsync(cloneCommand, {
      timeout: 120000, // 2 minute timeout
    });

    return {
      success: true,
      output: relativePath,
    };
  } catch (error) {
    // Clean up partial clone if it exists
    if (fs.existsSync(outputPath)) {
      fs.rmSync(outputPath, { recursive: true, force: true });
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      reason: `Failed to clone repository: ${errorMessage}`,
    };
  }
}

/**
 * Extract repository name from GitHub/GitLab URL
 */
function extractRepoName(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);

    if (pathParts.length >= 2) {
      // Get last part and remove .git suffix if present
      let repoName = pathParts[pathParts.length - 1];
      repoName = repoName.replace(/\.git$/, '');
      return repoName;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Find a unique path for the repository, appending -2, -3, etc. if needed
 */
function findUniqueRepoPath(reposDir: string, baseName: string): string {
  let candidatePath = path.join(reposDir, baseName);

  if (!fs.existsSync(candidatePath)) {
    return candidatePath;
  }

  let suffix = 2;
  while (fs.existsSync(path.join(reposDir, `${baseName}-${suffix}`))) {
    suffix++;
  }

  return path.join(reposDir, `${baseName}-${suffix}`);
}
