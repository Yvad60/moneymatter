import { loadUserData } from '@/api';
import { resetQueryCaches } from '@/lib/query-persister';
import { USER } from '@tests/mocks';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from './auth';
import { useUserStore } from './user';

vi.mock('@/api', () => ({ loadUserData: vi.fn(), startFeatureTrial: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  authClient: {},
  getSession: vi.fn(),
  signIn: { email: vi.fn().mockResolvedValue({}) },
  signOut: vi.fn(),
  signUp: {},
}));
vi.mock('@/lib/query-persister', () => ({
  resetQueryCaches: vi.fn().mockResolvedValue(true),
  collectPersistedQueryGarbage: vi.fn(),
}));
vi.mock('@/lib/posthog', () => ({
  identifyUser: vi.fn(),
  resetUser: vi.fn(),
  startSessionRecording: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
}));
vi.mock('@/lib/sentry', () => ({ captureException: vi.fn(), clearSentryUser: vi.fn(), setSentryUser: vi.fn() }));
vi.mock('@/components/notification-center', () => ({ dismissPersistentNotifications: vi.fn() }));
vi.mock('@tanstack/vue-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/stores', async () => {
  const { useUserStore: realUserStore } = await import('./user');
  return {
    useUserStore: realUserStore,
    useCategoriesStore: () => ({ loadCategories: vi.fn() }),
    useCurrenciesStore: () => ({ loadBaseCurrency: vi.fn() }),
  };
});

describe('useAuthStore login', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.mocked(loadUserData).mockResolvedValue(USER);
  });

  // User-gated queries start fetching once the user is published; a wipe after that orphans them.
  it('wipes the previous user cache before publishing the new user', async () => {
    localStorage.setItem('persisted-queries-user-id', String(USER.id + 1));
    const userStore = useUserStore();
    let userAtWipe: unknown = 'not-called';
    vi.mocked(resetQueryCaches).mockImplementation(async () => {
      userAtWipe = userStore.user;
      return true;
    });

    await useAuthStore().login({ email: 'a@b.c', password: 'x' });

    expect(userAtWipe).toBeNull();
    expect(userStore.user).toEqual(USER);
  });
});
