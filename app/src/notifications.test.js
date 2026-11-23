// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createNotificationCenter } from './notifications.js';

const STORAGE_KEY = 'arbiter.notifications.test';

function mountCenter() {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const center = createNotificationCenter({ mount, storageKey: STORAGE_KEY });
  return { mount, center };
}

function readStored() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
}

describe('createNotificationCenter', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('caps at MAX_ITEMS (50) keeping newest first', () => {
    const { center } = mountCenter();
    for (let i = 0; i < 60; i += 1) {
      center.push(`message-${i}`);
    }

    const stored = readStored();
    expect(stored).toHaveLength(50);
    expect(stored[0].message).toBe('message-59');
    expect(stored[49].message).toBe('message-10');

    center.destroy();
  });

  it('marks every item read when the panel opens and persists it', () => {
    const { center } = mountCenter();
    center.push('first');
    center.push('second');

    // Items pushed while the panel is closed start unread.
    expect(readStored().every((item) => item.read === false)).toBe(true);

    center.open();

    const stored = readStored();
    expect(stored).toHaveLength(2);
    expect(stored.every((item) => item.read === true)).toBe(true);

    center.destroy();
  });

  it('starts empty without throwing on corrupt stored JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');

    let center;
    expect(() => {
      ({ center } = mountCenter());
    }).not.toThrow();

    // A fresh push works and replaces the corrupt payload with valid JSON.
    center.push('after-corrupt');
    const stored = readStored();
    expect(stored).toHaveLength(1);
    expect(stored[0].message).toBe('after-corrupt');

    center.destroy();
  });

  it('removes listeners and node on destroy()', () => {
    const { mount, center } = mountCenter();
    center.push('hello');

    const wrap = mount.querySelector('.notif-wrap') || mount.firstElementChild;
    expect(wrap).toBeTruthy();

    center.destroy();

    expect(mount.contains(wrap)).toBe(false);
    expect(() => document.body.click()).not.toThrow();
  });
});
