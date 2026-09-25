import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // The wallets-kit dependency chain references Node's `global` at import
  // time. Without this polyfill the production build silently breaks every
  // wallet-connect click (this was a real bug found via a headless-browser
  // click-through in the original build, not caught by `vite build` alone).
  define: {
    global: 'globalThis',
  },
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
});
