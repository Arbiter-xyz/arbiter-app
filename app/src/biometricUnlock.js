const CREDENTIAL_KEY = 'arbiter:local-wallet-biometric-credential';
const bytes = (length) => crypto.getRandomValues(new Uint8Array(length));
const encode = (value) => btoa(String.fromCharCode(...new Uint8Array(value)));
const decode = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

/**
 * Whether this device/browser can perform a WebAuthn ceremony at all.
 * Used by callers to decide between the biometric gate and the password fallback.
 *
 * @returns {boolean} `true` if WebAuthn is available in this environment.
 */
export function isBiometricUnlockSupported() {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
}

/**
 * Whether a biometric credential has already been enrolled on this device.
 *
 * @returns {boolean} `true` if an enrolled credential id is stored.
 */
export function isBiometricUnlockEnrolled() {
  return isBiometricUnlockSupported() && !!localStorage.getItem(CREDENTIAL_KEY);
}

export async function enrollBiometricUnlock() {
  if (!isBiometricUnlockSupported() || localStorage.getItem(CREDENTIAL_KEY)) return false;
  try {
    const credential = await navigator.credentials.create({ publicKey: {
      challenge: bytes(32), rp: { name: 'Arbiter' }, user: { id: bytes(16), name: 'local-wallet', displayName: 'Arbiter quick-start wallet' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' }, timeout: 60_000,
    } });
    localStorage.setItem(CREDENTIAL_KEY, encode(credential.rawId));
    return true;
  } catch { return false; }
}

/**
 * Runs a WebAuthn assertion to prove the user is present and verified.
 *
 * IMPORTANT: This only proves the biometric ceremony succeeded. It does NOT
 * decrypt, derive, or return any wallet secret/key material. The resolved
 * value is a bare boolean indicating ceremony success, not key access.
 * Callers must not treat a `true` result as authorization to read or use
 * secret material; any actual secret retrieval must be performed separately.
 *
 * @returns {Promise<boolean>} `true` if the WebAuthn ceremony succeeded, `false` otherwise.
 */
export async function unlockLocalWalletSecret() {
  const id = localStorage.getItem(CREDENTIAL_KEY);
  if (!id || !isBiometricUnlockSupported()) return false;
  try {
    await navigator.credentials.get({ publicKey: { challenge: bytes(32), allowCredentials: [{ type: 'public-key', id: decode(id) }], userVerification: 'required', timeout: 60_000 } });
    return true;
  } catch { return false; }
}

/**
 * Gate a secret-reveal/copy action behind a biometric check when enrolled.
 *
 * - If biometrics are not supported or not enrolled, resolves `true` so the
 *   caller falls back to its existing password-reveal flow.
 * - If enrolled, resolves `true` only when the WebAuthn ceremony succeeds;
 *   a cancelled/failed ceremony resolves `false` so the caller can abort.
 *
 * @returns {Promise<boolean>} `true` if the action may proceed.
 */
export async function authorizeSecretReveal() {
  if (!isBiometricUnlockEnrolled()) return true;
  return unlockLocalWalletSecret();
}
