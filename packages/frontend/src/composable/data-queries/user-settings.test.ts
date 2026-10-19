import { type UserSettingsSchema, getUserSettings, updateUserSettings } from '@/api/user-settings';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import { useUserSettings } from './user-settings';

vi.mock('@/api/user-settings', () => ({
  getUserSettings: vi.fn(),
  updateUserSettings: vi.fn(),
  patchUserSettings: vi.fn(),
}));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addErrorNotification: vi.fn() }),
}));

const mountComposable = ({ queryClient }: { queryClient: QueryClient }) => {
  let result!: ReturnType<typeof useUserSettings>;
  mount(
    defineComponent({
      setup() {
        result = useUserSettings();
        return () => null;
      },
    }),
    { global: { plugins: [[VueQueryPlugin, { queryClient }]] } },
  );
  return result;
};

describe('useUserSettings', () => {
  it('shares isUpdating across instances while a full update is in flight', async () => {
    const settings = {} as UserSettingsSchema;
    let resolveUpdate!: (value: UserSettingsSchema) => void;
    vi.mocked(getUserSettings).mockResolvedValue(settings);
    vi.mocked(updateUserSettings).mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    const queryClient = new QueryClient();
    const first = mountComposable({ queryClient });
    const second = mountComposable({ queryClient });

    first.mutate(settings);
    await vi.waitFor(() => expect(second.isUpdating.value).toBe(true));

    resolveUpdate(settings);
    await vi.waitFor(() => expect(second.isUpdating.value).toBe(false));
  });
});
