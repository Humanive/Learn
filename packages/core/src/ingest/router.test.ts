import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IngestRouter } from './router.js';

describe('IngestRouter', () => {
  const router = new IngestRouter();

  describe('detectType', () => {
    it('should detect GitHub repos', () => {
      expect(router.detectType('https://github.com/user/repo')).toBe('repos');
      expect(router.detectType('https://github.com/org/project-name')).toBe('repos');
    });

    it('should detect arXiv papers as pdf', () => {
      expect(router.detectType('https://arxiv.org/abs/2301.12345')).toBe('pdf');
    });

    it('should detect YouTube videos', () => {
      expect(router.detectType('https://youtube.com/watch?v=abc123')).toBe('video');
      expect(router.detectType('https://youtu.be/abc123')).toBe('video');
    });

    it('should detect PDF URLs', () => {
      expect(router.detectType('https://example.com/paper.pdf')).toBe('pdf');
    });

    it('should detect webpages', () => {
      expect(router.detectType('https://example.com/article')).toBe('web');
    });

    it('should detect local folders', () => {
      expect(router.detectType('/tmp')).toBe('local');
    });

    it('should treat local paths as local, including ones that do not exist yet', () => {
      expect(router.detectType('./notes/missing-dir')).toBe('local');
      expect(router.detectType('~/some/file.md')).toBe('local');
    });

    it('should detect existing local PDF files as pdf', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-router-test-'));
      const pdf = path.join(dir, 'paper.pdf');
      fs.writeFileSync(pdf, '%PDF-1.4');
      try {
        expect(router.detectType(pdf)).toBe('pdf');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('should detect PDF URLs with query strings', () => {
      expect(router.detectType('https://example.com/paper.pdf?dl=1')).toBe('pdf');
    });

    it('should reject sources that are neither URLs nor local paths', () => {
      expect(() => router.detectType('not-a-url')).toThrow('Cannot determine resource type');
      expect(() => router.detectType('ftp://example.com/file')).toThrow('Cannot determine resource type');
    });
  });

  describe('generateFilename', () => {
    it('should generate safe filenames from URLs', () => {
      const filename = router.generateFilename('https://example.com/my-article');
      expect(filename).toBe('my-article.md');
    });

    it('should sanitize special characters', () => {
      const filename = router.generateFilename('https://example.com/article#section');
      expect(filename).toBe('article-section.md');
    });

    it('should handle custom extensions', () => {
      const filename = router.generateFilename('https://example.com/doc', '.txt');
      expect(filename).toBe('doc.txt');
    });
  });

  describe('expandPath', () => {
    it('should expand tilde in paths', () => {
      const expanded = router.expandPath('~/Documents/test');
      expect(expanded).not.toContain('~');
    });

    it('should leave absolute paths unchanged', () => {
      const path = '/absolute/path';
      expect(router.expandPath(path)).toBe(path);
    });
  });
});
