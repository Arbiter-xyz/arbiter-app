export const DEFAULT_BACKEND_URL = 'http://localhost:4000';

/**
 * Resolves the backend origin URL from Vite env or process.env, falling back
 * to http://localhost:4000 (matching runtime JS client defaults).
 */
export function resolveBackendUrl(env = {}, processEnv = {}) {
  return env.VITE_BACKEND_URL || processEnv.VITE_BACKEND_URL || DEFAULT_BACKEND_URL;
}

/**
 * Safely replaces %VITE_BACKEND_URL% in HTML content with the resolved backend URL.
 */
export function replaceHtmlEnv(html, backendUrl = DEFAULT_BACKEND_URL) {
  if (typeof html !== 'string') return html;
  return html.replaceAll('%VITE_BACKEND_URL%', backendUrl);
}

/**
 * Vite plugin that replaces %VITE_BACKEND_URL% placeholders before Vite's
 * default html-env transform runs, preventing missing-env warnings and literal leakage.
 */
export function htmlEnvFallbackPlugin(backendUrl = DEFAULT_BACKEND_URL) {
  return {
    name: 'html-env-fallback',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return replaceHtmlEnv(html, backendUrl);
      },
    },
  };
}

/**
 * Vite plugin that asserts no unreplaced %VITE_ placeholders remain in any emitted HTML bundle.
 */
export function verifyNoUnreplacedHtmlEnvPlugin() {
  return {
    name: 'verify-no-unreplaced-html-env',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const [fileName, file] of Object.entries(bundle)) {
        if (fileName.endsWith('.html') && typeof file.source === 'string') {
          if (file.source.includes('%VITE_')) {
            throw new Error(
              `Production build failed: unreplaced %VITE_ placeholder found in ${fileName}`,
            );
          }
        }
      }
    },
  };
}
