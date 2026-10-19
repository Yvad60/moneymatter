import { listReceivedShareInvitations } from '@/api/share';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import { RESOURCE_TYPES } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';

import ShareInvitationDialog from './share-invitation-dialog.vue';
import HouseholdInvitationContent from './share-invitation/household-invitation-content.vue';

const { makeContentStub } = vi.hoisted(() => ({
  makeContentStub: async ({ testId }: { testId: string }) => {
    const { defineComponent, h } = await import('vue');
    return defineComponent({
      props: { invitation: { type: Object, required: true } },
      emits: ['accepted', 'declined', 'close'],
      setup: (props) => () => h('div', { 'data-testid': testId }, props.invitation.token),
    });
  },
}));

vi.mock('@/api/share', () => ({
  listReceivedShareInvitations: vi.fn(),
}));

vi.mock('@/components/common/responsive-dialog.vue', () => ({
  default: { template: '<div><slot /></div>' },
}));

vi.mock('./share-invitation/household-invitation-content.vue', async () => ({
  default: await makeContentStub({ testId: 'household-content-stub' }),
}));

vi.mock('./share-invitation/resource-share-invitation-content.vue', async () => ({
  default: await makeContentStub({ testId: 'resource-content-stub' }),
}));

const HOUSEHOLD_STUB = '[data-testid="household-content-stub"]';
const RESOURCE_STUB = '[data-testid="resource-content-stub"]';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: {} },
  missingWarn: false,
  fallbackWarn: false,
});

const buildInvitation = ({
  token,
  resourceType = RESOURCE_TYPES.household,
}: {
  token: string;
  resourceType?: string;
}) => ({
  id: `invite-${token}`,
  token,
  resourceType,
});

const setReceivedList = ({ invitations }: { invitations: ReturnType<typeof buildInvitation>[] }) => {
  vi.mocked(listReceivedShareInvitations).mockResolvedValue(invitations as never);
};

const mountDialog = async ({ token }: { token: string }) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(ShareInvitationDialog, {
    props: { token },
    global: { plugins: [[VueQueryPlugin, { queryClient }], i18n] },
  });
  await flushPromises();
  return { wrapper, queryClient };
};

const refetchReceivedList = async ({ queryClient }: { queryClient: QueryClient }) => {
  await queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsReceived });
  await flushPromises();
};

describe('ShareInvitationDialog', () => {
  it('renders the content component matching the invitation resourceType', async () => {
    setReceivedList({
      invitations: [buildInvitation({ token: 'A' }), buildInvitation({ token: 'B', resourceType: 'account' })],
    });

    const household = await mountDialog({ token: 'A' });
    expect(household.wrapper.find(HOUSEHOLD_STUB).text()).toBe('A');
    expect(household.wrapper.find(RESOURCE_STUB).exists()).toBe(false);

    const resource = await mountDialog({ token: 'B' });
    expect(resource.wrapper.find(RESOURCE_STUB).text()).toBe('B');
    expect(resource.wrapper.find(HOUSEHOLD_STUB).exists()).toBe(false);
  });

  it('keeps the content mounted when the accepted invitation drops out of the refetched list', async () => {
    setReceivedList({ invitations: [buildInvitation({ token: 'A' })] });
    const { wrapper, queryClient } = await mountDialog({ token: 'A' });

    wrapper.findComponent(HouseholdInvitationContent).vm.$emit('accepted');
    setReceivedList({ invitations: [] });
    await refetchReceivedList({ queryClient });

    expect(wrapper.find(HOUSEHOLD_STUB).exists()).toBe(true);
    expect(wrapper.text()).not.toContain('titleNotFound');
  });

  it('falls back to not-found when the invitation disappears without being acted on', async () => {
    setReceivedList({ invitations: [buildInvitation({ token: 'A' })] });
    const { wrapper, queryClient } = await mountDialog({ token: 'A' });
    expect(wrapper.find(HOUSEHOLD_STUB).exists()).toBe(true);

    setReceivedList({ invitations: [] });
    await refetchReceivedList({ queryClient });

    expect(wrapper.find(HOUSEHOLD_STUB).exists()).toBe(false);
    expect(wrapper.text()).toContain('titleNotFound');
  });

  it('shows not-found for a different token after acting on the previous one', async () => {
    setReceivedList({ invitations: [buildInvitation({ token: 'A' })] });
    const { wrapper, queryClient } = await mountDialog({ token: 'A' });

    wrapper.findComponent(HouseholdInvitationContent).vm.$emit('accepted');
    setReceivedList({ invitations: [] });
    await refetchReceivedList({ queryClient });
    expect(wrapper.find(HOUSEHOLD_STUB).exists()).toBe(true);

    await wrapper.setProps({ token: 'B' });
    await flushPromises();

    expect(wrapper.find(HOUSEHOLD_STUB).exists()).toBe(false);
    expect(wrapper.text()).toContain('titleNotFound');
  });
});
