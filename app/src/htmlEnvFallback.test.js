import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_BACKEND_URL,
  resolveBackendUrl,
  replaceHtmlEnv,
  htmlEnvFallbackPlugin,
  verifyNoUnreplacedHtmlEnvPlugin,
} from './htmlEnvFallback.js';

describe('htmlEnvFallback', () => {
  describe('resolveBackendUrl', () => {
    it('falls back to DEFAULT_BACKEND_URL when both env and processEnv are empty', () => {
      expect(resolveBackendUrl({}, {})).toBe(DEFAULT_BACKEND_URL);
      expect(DEFAULT_BACKEND_URL).toBe('http://localhost:4000');
    });

    it('prefers Vite env VITE_BACKEND_URL when present', () => {
      expect(
        resolveBackendUrl(
          { VITE_BACKEND_URL: 'https://api.arbiter.example' },
          { VITE_BACKEND_URL: 'https://process.arbiter.example' },
        ),
      ).toBe('https://api.arbiter.example');
    });

    it('falls back to processEnv VITE_BACKEND_URL when Vite env is empty', () => {
      expect(
        resolveBackendUrl(
          {},
          { VITE_BACKEND_URL: 'https://process.arbiter.example' },
        ),
      ).toBe('https://process.arbiter.example');
    });
  });

  describe('replaceHtmlEnv', () => {
    it('replaces all %VITE_BACKEND_URL% occurrences with the resolved URL', () => {
      const template = `
        <meta property="og:image" content="%VITE_BACKEND_URL%/og/leaderboard.png" />
        <meta name="twitter:image" content="%VITE_BACKEND_URL%/og/leaderboard.png" />
      `;
      const result = replaceHtmlEnv(template, 'https://backend.arbiter.xyz');
      expect(result).not.toContain('%VITE_BACKEND_URL%');
      expect(result).toContain('content="https://backend.arbiter.xyz/og/leaderboard.png"');
    });

    it('handles non-string inputs gracefully', () => {
      expect(replaceHtmlEnv(null)).toBe(null);
      expect(replaceHtmlEnv(undefined)).toBe(undefined);
    });
  });

  describe('htmlEnvFallbackPlugin', () => {
    it('configures pre-order transformIndexHtml that replaces placeholders', () => {
      const plugin = htmlEnvFallbackPlugin('http://localhost:4000');
      expect(plugin.name).toBe('html-env-fallback');
      expect(plugin.transformIndexHtml.order).toBe('pre');

      const sampleHtml = '<meta property="og:image" content="%VITE_BACKEND_URL%/og/worker.png" />';
      const transformed = plugin.transformIndexHtml.handler(sampleHtml);
      expect(transformed).toBe('<meta property="og:image" content="http://localhost:4000/og/worker.png" />');
    });
  });

  describe('verifyNoUnreplacedHtmlEnvPlugin', () => {
    it('passes silently when bundle contains no %VITE_ placeholders', () => {
      const plugin = verifyNoUnreplacedHtmlEnvPlugin();
      const validBundle = {
        'leaderboard.html': {
          source: '<meta property="og:image" content="http://localhost:4000/og/leaderboard.png" />',
        },
      };

      expect(() => plugin.generateBundle(null, validBundle)).not.toThrow();
    });

    it('throws a descriptive error when any emitted HTML contains unreplaced %VITE_ placeholders', () => {
      const plugin = verifyNoUnreplacedHtmlEnvPlugin();
      const faultyBundle = {
        'worker.html': {
          source: '<meta property="og:image" content="%VITE_BACKEND_URL%/og/worker.png" />',
        },
      };

      expect(() => plugin.generateBundle(null, faultyBundle)).toThrow(
        /Production build failed: unreplaced %VITE_ placeholder found in worker\.html/,
      );
    });
  });

  describe('emitted build verification (regression for issue #496)', () => {
    it('emits real URLs in both og:image and twitter:image tags with no literal %VITE_ in dist', () => {
      const distLeaderboard = resolve(__dirname, '../dist/leaderboard.html');
      const distWorker = resolve(__dirname, '../dist/worker.html');

      if (existsSync(distLeaderboard) && existsSync(distWorker)) {
        const lbHtml = readFileSync(distLeaderboard, 'utf-8');
        const wkHtml = readFileSync(distWorker, 'utf-8');

        expect(lbHtml).not.toContain('%VITE_');
        expect(wkHtml).not.toContain('%VITE_');

        expect(lbHtml).toMatch(/content="https?:\/\/[^"]+\/og\/leaderboard\.png"/);
        expect(wkHtml).toMatch(/content="https?:\/\/[^"]+\/og\/leaderboard\.png"/);
      }
    });
  });
});
