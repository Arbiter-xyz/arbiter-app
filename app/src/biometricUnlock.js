const CREDENTIAL_KEY = 'arbiter:local-wallet-biometric-credential';
const bytes = (length) => crypto.getRandomValues(new Uint8Array(length));
const encode = (value) => btoa(String.fromCharCode(...new Uint8Array(value)));
const decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

export async function enrollBiometricUnlock() {
  if (!window.PublicKeyCredential || localStorage.getItem(CREDENTIAL_KEY)) return false;
  try {
    const credential = await navigator.credentials.create({ publicKey: {
      challenge: bytes(32), rp: { name: 'Arbiter' }, user: { id: bytes(16), name: 'local-wallet', displayName: 'Arbiter quick-start wallet' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' }, timeout: 60_000,
    } });
    localStorage.setItem(CREDENTIAL_KEY, encode(credential.rawId));
    return true;
  } catch { return false; }
}

export function hasBiometricEnrollment() {
  return Boolean(typeof window !== 'undefined' && window.PublicKeyCredential && localStorage.getItem(CREDENTIAL_KEY));
}

export async function unlockLocalWalletSecret() {
  const id = localStorage.getItem(CREDENTIAL_KEY);
  if (!id || !window.PublicKeyCredential) return false;
  await navigator.credentials.get({ publicKey: { challenge: bytes(32), allowCredentials: [{ type: 'public-key', id: decode(id) }], userVerification: 'required', timeout: 60_000 } });
  return true;
}

/**
 * Gates secret reveal/copy behind WebAuthn platform verification when a
 * biometric credential has been enrolled on this device, while degrading
 * gracefully (returning true) when WebAuthn is unavailable or not enrolled.
 */
export async function gateLocalWalletSecretAccess() {
  if (!hasBiometricEnrollment()) return true;
  try {
    return await unlockLocalWalletSecret();
  } catch {
    return false;
  }
}
