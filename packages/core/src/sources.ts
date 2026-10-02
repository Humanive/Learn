import * as fs from 'fs';
import { SourceEntry } from './types.js';

export class SourcesManager {
  /**
   * Parse SOURCES.md file
   */
  parse(sourcesPath: string): {
    inbox: SourceEntry[];
    processing: SourceEntry[];
    done: SourceEntry[];
  } {
    const content = fs.readFileSync(sourcesPath, 'utf-8');
    const lines = content.split('\n');

    const result = {
      inbox: [] as SourceEntry[],
      processing: [] as SourceEntry[],
      done: [] as SourceEntry[],
    };

    let currentSection: 'inbox' | 'processing' | 'done' | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === '## Inbox') {
        currentSection = 'inbox';
        continue;
      } else if (trimmed === '## Processing') {
        currentSection = 'processing';
        continue;
      } else if (trimmed === '## Done') {
        currentSection = 'done';
        continue;
      }

      if (trimmed.startsWith('-') && currentSection) {
        const entry = this.parseEntry(trimmed);
        if (entry) {
          result[currentSection].push(entry);
        }
      }
    }

    return result;
  }

  private parseEntry(line: string): SourceEntry | null {
    const match = line.match(/^-\s+(.+?)(?:\s+(#\S+(?:\s+#\S+)*))?$/);
    if (!match) return null;

    const url = match[1].trim();
    const tagsStr = match[2] || '';
    const tags = tagsStr
      .split(/\s+/)
      .filter((t) => t.startsWith('#'))
      .map((t) => t.substring(1));

    return {
      url,
      tags,
      status: 'inbox',
    };
  }

  addEntry(
    sourcesPath: string,
    url: string,
    tags: string[],
    section: 'inbox' | 'processing' | 'done' = 'inbox'
  ): void {
    let content = fs.readFileSync(sourcesPath, 'utf-8');
    const tagStr = tags.length > 0 ? ' ' + tags.map((t) => `#${t}`).join(' ') : '';
    const entry = `- ${url}${tagStr}\n`;

    const sectionHeader = `## ${section.charAt(0).toUpperCase() + section.slice(1)}`;
    const sectionIndex = content.indexOf(sectionHeader);

    if (sectionIndex === -1) {
      throw new Error(`Section "${section}" not found in SOURCES.md`);
    }

    const headerEnd = content.indexOf('\n', sectionIndex);
    const insertPos = headerEnd + 1;

    let actualInsertPos = insertPos;
    const lines = content.substring(insertPos).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === '' || line.startsWith('<!--')) {
        actualInsertPos = insertPos + lines.slice(0, i + 1).join('\n').length + 1;
      } else {
        break;
      }
    }

    content =
      content.substring(0, actualInsertPos) +
      entry +
      content.substring(actualInsertPos);

    fs.writeFileSync(sourcesPath, content);
  }

  moveEntry(
    sourcesPath: string,
    url: string,
    from: 'inbox' | 'processing' | 'done',
    to: 'inbox' | 'processing' | 'done'
  ): void {
    const sources = this.parse(sourcesPath);
    const entry = sources[from].find((e) => e.url === url);

    if (!entry) {
      throw new Error(`Entry "${url}" not found in ${from} section`);
    }

    this.removeEntry(sourcesPath, url, from);
    this.addEntry(sourcesPath, entry.url, entry.tags, to);
  }

  private removeEntry(
    sourcesPath: string,
    url: string,
    section: 'inbox' | 'processing' | 'done'
  ): void {
    let content = fs.readFileSync(sourcesPath, 'utf-8');
    const lines = content.split('\n');
    const sectionHeader = `## ${section.charAt(0).toUpperCase() + section.slice(1)}`;

    let inSection = false;
    const newLines: string[] = [];

    for (const line of lines) {
      if (line.trim() === sectionHeader) {
        inSection = true;
        newLines.push(line);
        continue;
      }

      if (line.trim().startsWith('## ')) {
        inSection = false;
      }

      if (inSection && line.trim().startsWith('-')) {
        const entry = this.parseEntry(line.trim());
        if (entry && entry.url === url) {
          continue;
        }
      }

      newLines.push(line);
    }

    fs.writeFileSync(sourcesPath, newLines.join('\n'));
  }
}

export const sourcesManager = new SourcesManager();
