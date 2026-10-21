# Arbiter mobile shell (Capacitor)

A thin native wrapper around the existing worker console (`app/`), per issue #56.
It ships the unmodified Vite build (`app/dist`) inside a native WebView — no
DOM logic is duplicated as native components.

## Build an installable artifact

```bash
cd mobile
npm install
npm run add:android        # once; or add:ios on macOS with Xcode
npm run android:apk        # → android/app/build/outputs/apk/debug/app-debug.apk
```

Set `VITE_BACKEND_URL` in `app/.env` to a backend reachable from the device
(not `localhost`) before building.

## What works inside the WebView

| Feature | Behaviour in the shell |
| --- | --- |
| Quick-start wallet (`localWallet.js`) | Works unmodified — pure `localStorage` + in-WebView signing. Recommended path. |
| Extension / deep-link wallets | Mostly unavailable; the console logs a hint pointing to Quick start (`platform.js`). |
| Onboard, go online (SSE), answer | Same web code path as the browser. |
| Push notifications | Web Push is unavailable in WebViews; the Enable button is disabled with an explicit message instead of failing silently. Native push (FCM/APNs) is a follow-up. |
| Clipboard | `navigator.clipboard` works over the `https` scheme; failures fall back to the existing "copy manually" message. |
