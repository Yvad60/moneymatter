import { afterEach, describe, expect, it } from 'vitest';

import { RESET_PASSWORD_TOKEN_STORAGE_KEY, stashResetPasswordToken } from './reset-password-token';

describe('stashResetPasswordToken', () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('moves the token to sessionStorage and strips it from the URL, keeping other params', () => {
    window.history.replaceState(null, '', '/reset-password?token=abc123&error=X#h');

    stashResetPasswordToken();

    expect(sessionStorage.getItem(RESET_PASSWORD_TOKEN_STORAGE_KEY)).toBe('abc123');
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/reset-password?error=X#h',
    );
  });

  it('ignores a token param on other paths', () => {
    window.history.replaceState(null, '', '/dashboard?token=abc123');

    stashResetPasswordToken();

    expect(sessionStorage.getItem(RESET_PASSWORD_TOKEN_STORAGE_KEY)).toBeNull();
    expect(window.location.search).toBe('?token=abc123');
  });
});
