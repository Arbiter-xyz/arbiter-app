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

// Shared wallet-connect setup for the worker console (main.js) and the buyer
// dashboard (dashboard.js) — see issue #19. Both pages need the exact same
// StellarWalletsKit module list and the same connect/quick-start button
// wiring; keeping one copy here means a future adapter add/remove or a
// busy-guard fix can't silently drift between the two pages the way the two
// hand-copied versions already had.

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
 * selected (extension) or created (quick-start) — `quickStart` is the hook
 * the two pages need to differ on (main.js shows its backup/reveal panel
 * only for the local quick-start wallet; dashboard.js has no such panel and
 * can ignore the flag).
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
      const localWallet = createOrLoadLocalWallet();
      const { address } = await localWallet.getAddress();
      await onActivated(localWallet, address, { quickStart: true });
      setBusy(false);
    } catch (err) {
      setBusy(false);
      onError?.(`Quick start failed: ${err.message}`);
    }
  });
}
