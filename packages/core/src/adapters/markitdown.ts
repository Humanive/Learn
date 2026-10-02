import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { AdapterContext, AdapterResult } from './types.js';

const execAsync = promisify(exec);

/**
 * Convert PDF to Markdown using MarkItDown CLI
 */
export async function markitdownAdapter(context: AdapterContext): Promise<AdapterResult> {
  const { source, workspacePath } = context;

  // Check if markitdown is available
  try {
    await execAsync('markitdown --version');
  } catch (error) {
    return {
      success: false,
      reason: 'markitdown CLI not found',
    };
  }

  // Only handle local file paths, not URLs
  if (source.startsWith('http://') || source.startsWith('https://')) {
    return {
      success: false,
      reason: 'markitdown adapter only handles local files, not URLs',
    };
  }

  // Expand path and check if file exists
  const sourcePath = expandPath(source);
  if (!fs.existsSync(sourcePath)) {
    return {
      success: false,
      reason: `Source file not found: ${source}`,
    };
  }

  if (!fs.statSync(sourcePath).isFile()) {
    return {
      success: false,
      reason: 'Source is not a file',
    };
  }

  // Generate output filename
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const sanitizedName = sanitizeFilename(baseName);
  const pdfDir = path.join(workspacePath, 'pdf');
  const outputPath = findUniqueFilePath(pdfDir, sanitizedName);
  const relativePath = path.relative(workspacePath, outputPath);

  // Run markitdown
  try {
    const { stdout } = await execAsync(`markitdown "${sourcePath}"`, {
      timeout: 120000, // 2 minute timeout
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large documents
    });

    // Write markdown to file
    fs.writeFileSync(outputPath, stdout, 'utf-8');

    return {
      success: true,
      output: relativePath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      reason: `Failed to convert PDF: ${errorMessage}`,
    };
  }
}

/**
 * Sanitize filename to remove special characters
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'document';
}

/**
 * Find a unique file path, appending -2, -3, etc. if needed
 */
function findUniqueFilePath(dir: string, baseName: string): string {
  let candidatePath = path.join(dir, `${baseName}.md`);

  if (!fs.existsSync(candidatePath)) {
    return candidatePath;
  }

  let suffix = 2;
  while (fs.existsSync(path.join(dir, `${baseName}-${suffix}.md`))) {
    suffix++;
  }

  return path.join(dir, `${baseName}-${suffix}.md`);
}

/**
 * Expand ~ in paths
 */
function expandPath(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(process.env.HOME || '', filePath.substring(2));
  }
  return filePath;
}
