import {
  StellarWalletsKit,
  WalletNetwork,
  FreighterModule,
  LobstrModule,
  xBullModule,
  HanaModule,
  AlbedoModule,
  HotWalletModule,
  LedgerModule,
} from '@creit.tech/stellar-wallets-kit';
import { createOrLoadLocalWallet } from './localWallet.js';

// Shared wallet-connect setup, originally duplicated between the worker
// console and the buyer dashboard (issue #19) — now the single connect flow
// for the unified role-aware shell (issue #34). Keeping one copy here means
// a future adapter add/remove or a busy-guard fix can't silently drift.

// Hand-picked, not allowAllModules(): explicit about which wallets we
// support (matching the original spec's list) rather than automatically
// inheriting whatever the kit adds in a future version — including
// hardware-wallet adapters (Trezor/Ledger) that pull in a large, more
// security-sensitive dependency tree we have no use for. See the README
// for the concrete CVE this sidesteps.
//
// LedgerModule is the one deliberate exception (issue #75): it is added
// explicitly by name rather than via allowAllModules(), so the Trezor
// adapters and their protobufjs dependency tree stay excluded. Ledger's
// browser integration is WebUSB/WebHID against the device directly (the
// kit's Ledger module), not a deep link into the Ledger Live companion
// app. Before merging, re-run round 5's audit process: grep the built
// bundle for `trezor`/`protobuf` and run `npm audit --audit-level=high`,
// confirming the critical/high count stays at zero.
export function createWalletKit() {
  return new StellarWalletsKit({
    network: WalletNetwork.TESTNET,
    modules: [new FreighterModule(), new LobstrModule(), new xBullModule(), new HanaModule(), new AlbedoModule(), new HotWalletModule(), new LedgerModule()],
  });
}

/**
 * Wires the "Connect wallet" / "Quick start" button pair against `kit`.
 *
 * Implements the busy-guard pattern both pages already relied on: a user
 * clicking both connect options in quick succession could otherwise let
 * whichever resolves last silently overwrite the other's in-flight
 * activation, so both buttons are disabled the instant either one starts,
 * and only re-enabled once activation settles (success or failure).
 *
 * `onActivated(wallet, address, { quickStart })` is awaited once a wallet is
 * selected (extension) or created (quick-start) — `quickStart` is a hook
 * callers can use to differ on quick-start-only behavior (e.g. showing a
 * backup/reveal panel for the local wallet).
 *
 * `onError(message)` receives a human-readable failure message (connect
 * cancelled/failed, quick start failed, or `onActivated` itself throwing) —
 * typically the page's own `log()` function.
 */
export function wireConnectButtons({ kit, connectButton, quickStartButton, onActivated, onError }) {
  function setBusy(busy) {
    connectButton.disabled = busy;
    quickStartButton.disabled = busy;
  }

  connectButton.addEventListener('click', async () => {
    setBusy(true);
    try {
      await kit.openModal({
        onWalletSelected: async (option) => {
          kit.setWallet(option.id);
          const { address } = await kit.getAddress();
          await onActivated(kit, address, { quickStart: false });
          setBusy(false);
        },
        onClosed: (err) => {
          setBusy(false);
          if (err) onError?.(`Wallet selection closed: ${err.message}`);
        },
      });
    } catch (err) {
      setBusy(false);
      onError?.(`Wallet connect failed: ${err.message}`);
    }
  });

  quickStartButton.addEventListener('click', async () => {
    setBusy(true);
    try {
      // Issue #29: the quick-start secret is now encrypted at rest, keyed
      // by a PIN entered once per session — never persisted itself, held
      // only for the duration of this call and inside the returned
      // wallet's closure. Use the same PIN every time on this browser.
      const pin = window.prompt(
        'Quick-start wallet PIN/passphrase\n\nProtects your key at rest in this browser. Never sent anywhere, never stored — use the same PIN every time you connect on this device.',
      );
      if (pin === null) {
        setBusy(false); // user cancelled the prompt
        return;
      }
      const localWallet = await createOrLoadLocalWallet(pin);
      const { address } = await localWallet.getAddress();
      await onActivated(localWallet, address, { quickStart: true });
      setBusy(false);
    } catch (err) {
      setBusy(false);
      onError?.(`Quick start failed: ${err.message}`);
    }
  });
}
