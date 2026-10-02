import * as fs from 'fs';
import * as path from 'path';
import { ResourceType } from '../types.js';

export class IngestRouter {
  /**
   * Detect the resource type (glossary name) of a URL or local path.
   * Throws if the source is neither a URL nor a local path.
   */
  detectType(source: string): ResourceType {
    if (this.isLocalPath(source)) {
      const resolved = this.expandPath(source);
      const isFile = fs.existsSync(resolved) && fs.statSync(resolved).isFile();
      if (isFile && resolved.toLowerCase().endsWith('.pdf')) {
        return 'pdf';
      }
      return 'local';
    }

    if (!this.isUrl(source)) {
      throw new Error(
        `Cannot determine resource type for "${source}": expected a URL or a local path (starting with /, ./, ../ or ~/)`
      );
    }

    if (this.isGitHubRepo(source)) {
      return 'repos';
    }

    // arXiv papers are PDFs
    if (this.isArxiv(source) || this.hasPdfExtension(source)) {
      return 'pdf';
    }

    if (this.isYouTube(source)) {
      return 'video';
    }

    return 'web';
  }

  private isLocalPath(source: string): boolean {
    return (
      source.startsWith('/') ||
      source.startsWith('./') ||
      source.startsWith('../') ||
      source.startsWith('~/')
    );
  }

  private isUrl(source: string): boolean {
    try {
      const url = new URL(source);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private hasPdfExtension(source: string): boolean {
    return new URL(source).pathname.toLowerCase().endsWith('.pdf');
  }

  private isGitHubRepo(source: string): boolean {
    const githubPattern = /^https?:\/\/(www\.)?github\.com\/[\w-]+\/[\w.-]+\/?$/;
    return githubPattern.test(source);
  }

  private isArxiv(source: string): boolean {
    return new URL(source).hostname.endsWith('arxiv.org');
  }

  private isYouTube(source: string): boolean {
    const host = new URL(source).hostname;
    return host.endsWith('youtube.com') || host === 'youtu.be';
  }

  /**
   * Generate a safe filename from a URL
   */
  generateFilename(url: string, extension: string = '.md'): string {
    const urlObj = new URL(url);
    let filename = urlObj.pathname.split('/').pop() || 'resource';

    // Remove existing extension
    filename = filename.replace(/\.[^.]+$/, '');

    // Include hash/fragment if present
    if (urlObj.hash) {
      filename += urlObj.hash;
    }

    // Sanitize filename
    filename = filename
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!filename) {
      filename = 'resource';
    }

    return filename + extension;
  }

  /**
   * Expand ~ in paths
   */
  expandPath(filePath: string): string {
    if (filePath.startsWith('~/')) {
      return path.join(process.env.HOME || '', filePath.substring(2));
    }
    return filePath;
  }
}

export const ingestRouter = new IngestRouter();
