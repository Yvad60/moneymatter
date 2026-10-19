import { OAUTH_PROVIDER } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  consumePendingLoginMethod,
  getLastLoginMethod,
  setLastLoginMethod,
  setPendingLoginMethod,
} from './last-login-method';

describe('last-login-method', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips a stored method', () => {
    setLastLoginMethod({ method: OAUTH_PROVIDER.github });

    expect(getLastLoginMethod()).toBe(OAUTH_PROVIDER.github);
  });

  it('ignores an unknown stored value', () => {
    localStorage.setItem('last-login-method', 'removed-provider');

    expect(getLastLoginMethod()).toBeNull();
  });

  it('consumes the pending method only once', () => {
    setPendingLoginMethod({ method: OAUTH_PROVIDER.google });

    expect(consumePendingLoginMethod()).toBe(OAUTH_PROVIDER.google);
    expect(consumePendingLoginMethod()).toBeNull();
  });

  it('degrades to a no-op when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => setLastLoginMethod({ method: 'email' })).not.toThrow();
    expect(getLastLoginMethod()).toBeNull();
  });
});
