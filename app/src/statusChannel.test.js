import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS, subscribeQuestionStatus } from './statusChannel.js';

function makeResponse({ ok = true, status = 200, data = { questions: [] } } = {}) {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
  };
}

describe('subscribeQuestionStatus', () => {
  let visibilityState;

  beforeEach(() => {
    vi.useFakeTimers();
    visibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete document.visibilityState;
  });

  function setup(overrides = {}) {
    const onSnapshot = vi.fn();
    const onConnection = vi.fn();
    const getToken = vi.fn().mockResolvedValue('tok');
    const fetchMock = vi.fn().mockResolvedValue(makeResponse());
    vi.stubGlobal('fetch', fetchMock);

    const channel = subscribeQuestionStatus({
      backendUrl: 'https://api.test',
      address: 'GADDR',
      getToken,
      onSnapshot,
      onConnection,
      ...overrides,
    });

    return { channel, fetchMock, onSnapshot, onConnection, getToken };
  }

  it('shares one in-flight request across concurrent resync() calls', async () => {
    const { channel, fetchMock } = setup();

    const first = channel.resync();
    const second = channel.resync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    channel.close();
  });

  it('skips polling while the tab is hidden', async () => {
    const { channel, fetchMock } = setup();
    await channel.ready;
    fetchMock.mockClear();

    visibilityState = 'hidden';
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(fetchMock).not.toHaveBeenCalled();

    channel.close();
  });

  it('calls onConnection(false) and rejects on a non-OK response', async () => {
    const { channel, onConnection } = setup({
      fetch: undefined,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ ok: false, status: 500 })));

    await expect(channel.resync()).rejects.toThrow('unexpected status 500');
    expect(onConnection).toHaveBeenCalledWith(false);

    channel.close();
  });

  it('removes listeners after close()', async () => {
    const { channel, fetchMock } = setup();
    await channel.ready;
    fetchMock.mockClear();

    channel.close();

    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
