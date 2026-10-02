import * as fs from 'fs';
import * as path from 'path';
import { AdapterContext, AdapterResult } from './types.js';

/**
 * Convert webpage to Markdown using Jina Reader API
 */
export async function jinaAdapter(context: AdapterContext): Promise<AdapterResult> {
  const { source, workspacePath, config } = context;

  // Check for API key
  if (!config.jinaApiKey) {
    return {
      success: false,
      reason: 'Jina API key not configured',
    };
  }

  // Validate URL
  try {
    new URL(source);
  } catch {
    return {
      success: false,
      reason: 'Invalid URL',
    };
  }

  // Generate filename from URL
  const filename = sanitizeFilename(source);
  const webDir = path.join(workspacePath, 'web');
  const outputPath = findUniqueFilePath(webDir, filename);
  const relativePath = path.relative(workspacePath, outputPath);

  // Call Jina Reader API
  const jinaUrl = `https://r.jina.ai/${source}`;

  try {
    const response = await fetch(jinaUrl, {
      headers: {
        'Authorization': `Bearer ${config.jinaApiKey}`,
        'X-Return-Format': 'markdown',
      },
      signal: AbortSignal.timeout(60000), // 60 second timeout
    });

    if (!response.ok) {
      return {
        success: false,
        reason: `Jina API error: ${response.status} ${response.statusText}`,
      };
    }

    const markdown = await response.text();

    // Write markdown to file
    fs.writeFileSync(outputPath, markdown, 'utf-8');

    return {
      success: true,
      output: relativePath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      reason: `Failed to fetch webpage: ${errorMessage}`,
    };
  }
}

/**
 * Sanitize URL to create a valid filename
 */
function sanitizeFilename(url: string): string {
  try {
    const urlObj = new URL(url);
    let name = urlObj.pathname.split('/').filter(Boolean).pop() || urlObj.hostname;

    // Remove extension if present
    name = name.replace(/\.[^.]+$/, '');

    // Sanitize
    name = name
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!name) {
      name = 'webpage';
    }

    return name;
  } catch {
    return 'webpage';
  }
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
