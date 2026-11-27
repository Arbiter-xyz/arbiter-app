import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

let backendUrl = 'http://localhost:4000';

// Origins referenced by the per-page Content-Security-Policy meta tags.
// Third-party origins are only allowed when the matching integration is
// configured, so an app with no Crisp/Sentry/PostHog can't be exfiltrated to
// them by an injected script.
function cspOrigins(env) {
  const origins = [
    env.VITE_BACKEND_URL || 'http://localhost:4000',
    env.VITE_HORIZON_URL || 'https://horizon-testnet.stellar.org',
    env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
  ];
  const scriptOrigins = [];
  if (env.VITE_CRISP_WEBSITE_ID) {
    // support.js injects Crisp's loader as an external script.
    scriptOrigins.push('https://client.crisp.chat');
    origins.push('https://client.crisp.chat');
  }
  if (env.VITE_SENTRY_DSN) {
    try {
      origins.push(new URL(env.VITE_SENTRY_DSN).origin);
    } catch {
      // A malformed DSN must not break the build; Sentry will fail open too.
    }
  }
  if (env.VITE_SESSION_REPLAY_POSTHOG_KEY) {
    origins.push(env.VITE_SESSION_REPLAY_HOST || 'https://us.i.posthog.com');
  }
  return {
    connect: [...new Set(origins)].join(' '),
    script: scriptOrigins.join(' '),
  };
}

export default defineConfig(({ mode }) => {
  const csp = cspOrigins(loadEnv(mode, __dirname, 'VITE_'));
  return {
    // The wallets-kit dependency chain references Node's `global` at import
    // time. Without this polyfill the production build silently breaks every
    // wallet-connect click (this was a real bug found via a headless-browser
    // click-through in the original build, not caught by `vite build` alone).
    define: {
      global: 'globalThis',
    },
    plugins: [
      {
        name: 'app-csp-origins',
        // Each HTML entry contains a static CSP meta tag with a single
        // placeholder; fill it from env at build and dev time alike.
        transformIndexHtml(html) {
          return html
            .replaceAll('%%CSP_ORIGINS%%', csp.connect)
            .replaceAll('%%CSP_SCRIPT_ORIGINS%%', csp.script);
        },
      },
    ],
    server: {
      port: 5173,
    },
    build: {
      rollupOptions: {
        // Multi-page build: the worker console (index.html) and the
        // read-only buyer dashboard (dashboard.html) are separate front
        // doors for separate audiences, but ship from the same static site.
        input: {
          main: resolve(__dirname, 'index.html'),
          dashboard: resolve(__dirname, 'dashboard.html'),
          leaderboard: resolve(__dirname, 'leaderboard.html'),
          worker: resolve(__dirname, 'worker.html'),
          admin: resolve(__dirname, 'admin.html'),
          customer: resolve(__dirname, 'customer.html'),
        },
        output: {
          // Real per-adapter code splitting: each wallet-adapter SDK is loaded
          // via dynamic import() at the moment the user selects that wallet, so
          // the wallet-kit dependency tree is emitted as one chunk per adapter
          // instead of a single 735KB monolith. The manualChunks function below
          // routes each adapter package (and its transitive deps) into its own
          // chunk; anything not matched falls through to Rollup's default
          // splitting, which keeps the shared wallet-kit core in a small common
          // chunk rather than duplicating it per adapter.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            // Match the wallet-adapter SDK packages. The package names follow
            // the `@<vendor>/wallet-adapter-<wallet>` convention, so we key the
            // chunk off the wallet segment to get one chunk per wallet.
            const adapter = id.match(
              /node_modules\/(?:@[^/]+\/)?wallet-adapter-([^/]+)\//,
            );
            if (adapter) return `wallet-adapter-${adapter[1]}`;
            // The shared wallet-kit core (base adapter, react hooks, error
            // types) is small and used by every adapter, so keep it in a single
            // shared chunk that all per-adapter chunks can reference.
            if (id.includes('wallet-kit') || id.includes('wallet-standard')) {
              return 'wallet-kit-core';
            }
            return undefined;
          },
        },
      },
      },
    },
  };
});
