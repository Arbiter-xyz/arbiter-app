// Runtime detection for the Capacitor mobile shell (issue #56). The shell
// loads the same Vite build inside a native WebView, so the web code stays
// the single codepath; these helpers only decide how to degrade.

export function isNativeShell() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

// Web push (PushManager + service worker) is unavailable in iOS/Android
// WebViews. Rather than letting the Enable button fail silently there,
// callers check this and surface push.unsupported instead.
export function webPushSupported() {
  return !isNativeShell() && 'serviceWorker' in navigator && 'PushManager' in window;
}
