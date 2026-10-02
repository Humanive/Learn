import * as fs from 'fs';
import * as path from 'path';
import { AdapterContext, AdapterResult } from './types.js';

/**
 * Create a symlink from local/<title> to the source path
 */
export async function localAdapter(context: AdapterContext): Promise<AdapterResult> {
  const { source, workspacePath } = context;

  // Resolve to absolute path
  const absoluteSource = path.resolve(source);

  // Check if source exists
  if (!fs.existsSync(absoluteSource)) {
    return {
      success: false,
      reason: `Source path not found: ${absoluteSource}`,
    };
  }

  // Check if source is readable
  try {
    fs.accessSync(absoluteSource, fs.constants.R_OK);
  } catch (error) {
    return {
      success: false,
      reason: `Source path is not readable: ${absoluteSource}`,
    };
  }

  // Extract basename for the symlink name
  const baseName = path.basename(absoluteSource);

  // Find unique path in local/ directory
  const localDir = path.join(workspacePath, 'local');
  const symlinkPath = findUniqueLocalPath(localDir, baseName);
  const relativePath = path.relative(workspacePath, symlinkPath);

  // Create symlink
  try {
    fs.symlinkSync(absoluteSource, symlinkPath);

    return {
      success: true,
      output: relativePath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      reason: `Failed to create symlink: ${errorMessage}`,
    };
  }
}

/**
 * Find a unique path for the symlink, appending -2, -3, etc. if needed
 */
function findUniqueLocalPath(localDir: string, baseName: string): string {
  let candidatePath = path.join(localDir, baseName);

  if (!fs.existsSync(candidatePath)) {
    return candidatePath;
  }

  let suffix = 2;
  while (fs.existsSync(path.join(localDir, `${baseName}-${suffix}`))) {
    suffix++;
  }

  return path.join(localDir, `${baseName}-${suffix}`);
}
