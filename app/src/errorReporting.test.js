import { describe, it, expect } from 'vitest';
import {
  scrubString,
  scrubValue,
  scrubBreadcrumb,
  scrubEvent,
} from './errorReporting.js';

// 56-char Stellar secret seed (S...)
const SECRET_SEED = 'S' + 'A'.repeat(55);
// 69-char muxed address (M...)
const MUXED_ADDRESS = 'M' + 'B'.repeat(68);
// JWT: eyJ...x.y.z
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

describe('scrubString', () => {
  it('redacts a 56-character Stellar secret seed', () => {
    const out = scrubString(`seed is ${SECRET_SEED} here`);
    expect(out).not.toContain(SECRET_SEED);
    expect(out).toContain('[redacted]');
  });

  it('redacts a 69-character muxed address', () => {
    const out = scrubString(`muxed ${MUXED_ADDRESS} end`);
    expect(out).not.toContain(MUXED_ADDRESS);
    expect(out).toContain('[redacted]');
  });

  it('redacts bearer tokens', () => {
    const out = scrubString('Authorization: Bearer abc.def');
    expect(out).not.toContain('abc.def');
    expect(out).toContain('[redacted]');
  });

  it('redacts JWTs', () => {
    const out = scrubString(`token=${JWT}`);
    expect(out).not.toContain(JWT);
    expect(out).toContain('[redacted]');
  });
});

describe('scrubValue', () => {
  it('redacts values under sensitive keys at depth', () => {
    const input = {
      ok: 'visible',
      nested: {
        secret: 'my-secret-value',
        token: 'my-token-value',
        password: 'my-password-value',
        keep: 'still-here',
      },
    };
    const out = scrubValue(input);
    expect(out.ok).toBe('visible');
    expect(out.nested.secret).toBe('[redacted]');
    expect(out.nested.token).toBe('[redacted]');
    expect(out.nested.password).toBe('[redacted]');
    expect(out.nested.keep).toBe('still-here');
  });
});

describe('scrubBreadcrumb', () => {
  it('drops ui.input breadcrumbs', () => {
    expect(scrubBreadcrumb({ category: 'ui.input', message: 'typed' })).toBeNull();
  });

  it('drops breadcrumbs targeting the backup secret', () => {
    expect(
      scrubBreadcrumb({ category: 'ui.click', data: { target: '#backup-secret' } }),
    ).toBeNull();
  });
});

describe('scrubEvent', () => {
  it('removes request headers/cookies/data and user', () => {
    const event = {
      user: { id: 'u1' },
      request: {
        url: 'https://example.com/path#frag',
        headers: { Authorization: 'Bearer abc.def' },
        cookies: { session: 'x' },
        data: { password: 'p' },
      },
    };
    const out = scrubEvent(event);
    expect(out.user).toBeUndefined();
    expect(out.request.headers).toBeUndefined();
    expect(out.request.cookies).toBeUndefined();
    expect(out.request.data).toBeUndefined();
    expect(out.request.url).toBe('https://example.com/path');
  });
});
