export const RESET_PASSWORD_PATH = '/reset-password';
export const RESET_PASSWORD_TOKEN_STORAGE_KEY = 'reset_password_token';

// Must run before Sentry/PostHog init so the single-use credential never reaches URL capture.
export const stashResetPasswordToken = () => {
  if (window.location.pathname !== RESET_PASSWORD_PATH) return;

  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  if (!token) return;

  sessionStorage.setItem(RESET_PASSWORD_TOKEN_STORAGE_KEY, token);
  url.searchParams.delete('token');
  window.history.replaceState(window.history.state, '', url.href);
};
