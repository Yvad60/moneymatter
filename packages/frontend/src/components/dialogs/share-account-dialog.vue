<script setup lang="ts">
import { listSentShareInvitations, listShareMembers } from '@/api/share';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import DemoRestricted from '@/components/demo/demo-restricted.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useShareInvitationDialog } from '@/composable/use-share-invitation-dialog';
import { useUserStore } from '@/stores';
import { useOnboardingStore } from '@/stores/onboarding';
import { type AccountModel, RESOURCE_TYPES, SHARE_INVITATION_STATUSES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { useVModel } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  account: AccountModel;
  open?: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { t } = useI18n();
const { isDemo, user } = storeToRefs(useUserStore());
const onboardingStore = useOnboardingStore();

const isOpen = useVModel(props, 'open', emit, { passive: true });

const {
  email,
  permission,
  permissionOptions,
  writeScope,
  writeScopeOptions,
  showsWriteScope,
  isEmailValid,
  canSubmit,
  mutation,
  submit,
} = useShareInvitationDialog({
  resourceType: RESOURCE_TYPES.account,
  resourceId: computed(() => props.account.id),
  isOpen,
  i18nNamespace: 'dialogs.shareAccountDialog',
  withWriteScope: true,
  onSuccess: () => onboardingStore.completeTask('share-account'),
});

// Non-blocking hint when the typed email belongs to a current household member: the
// per-account share overrides their household grant. An accepted invitation outlives the
// membership it created, so it only maps email to user id; the members list decides.
const { data: sentInvitations, isError: isSentInvitationsError } = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.shareInvitationsSent,
  queryFn: listSentShareInvitations,
  enabled: computed(() => isOpen.value),
});

const householdId = computed(() => user.value?.id ?? null);

const { data: householdMembers, isError: isHouseholdMembersError } = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.shareMembers, RESOURCE_TYPES.household, householdId.value]),
  queryFn: () => listShareMembers({ resourceType: RESOURCE_TYPES.household, resourceId: String(householdId.value) }),
  enabled: computed(() => isOpen.value && householdId.value !== null),
});

// A failed lookup can't rule membership out, so the template says so instead of hiding the hint.
const householdLookupFailed = computed(() => isSentInvitationsError.value || isHouseholdMembersError.value);

const matchingHouseholdMember = computed(() => {
  const typed = email.value.trim().toLowerCase();
  if (!typed) return null;
  const inviteeIds = new Set(
    (sentInvitations.value ?? [])
      .filter(
        (invitation) =>
          invitation.resourceType === RESOURCE_TYPES.household &&
          invitation.status === SHARE_INVITATION_STATUSES.accepted &&
          invitation.inviteeEmail.toLowerCase() === typed,
      )
      .map((invitation) => invitation.invitee?.id),
  );
  return (
    (householdMembers.value?.members ?? []).find((m) => m.role === 'recipient' && inviteeIds.has(m.user.id)) ?? null
  );
});

const matchingMemberLabel = computed(() => matchingHouseholdMember.value?.user.username ?? '');

const matchingMemberPermissionLabel = computed(() => {
  const member = matchingHouseholdMember.value;
  if (!member) return '';
  if (member.permission === SHARE_PERMISSIONS.read) return t('dialogs.shareAccountDialog.permissions.read');
  if (member.permission === SHARE_PERMISSIONS.write) return t('dialogs.shareAccountDialog.permissions.write');
  return t('dialogs.shareAccountDialog.permissions.manage');
});
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>{{ $t('dialogs.shareAccountDialog.title') }}</template>
    <template #description>
      {{ $t('dialogs.shareAccountDialog.description', { name: account.name }) }}
    </template>

    <form class="grid gap-4" @submit.prevent="submit">
      <InputField
        v-model="email"
        :label="$t('dialogs.shareAccountDialog.emailLabel')"
        :placeholder="$t('dialogs.shareAccountDialog.emailPlaceholder')"
        type="email"
        autocomplete="email"
      />

      <p v-if="matchingHouseholdMember" class="text-muted-foreground -mt-2 text-xs" data-testid="inverse-invite-hint">
        <i18n-t keypath="dialogs.shareAccountDialog.householdOverrideHint" tag="span">
          <template #invitee>
            <strong class="text-foreground">@{{ matchingMemberLabel }}</strong>
          </template>
          <template #permission>
            <strong class="text-foreground">{{ matchingMemberPermissionLabel }}</strong>
          </template>
        </i18n-t>
      </p>

      <p
        v-else-if="householdLookupFailed && isEmailValid"
        class="text-muted-foreground -mt-2 text-xs"
        data-testid="inverse-invite-lookup-failed"
      >
        {{ $t('dialogs.shareAccountDialog.householdLookupFailed') }}
      </p>

      <SelectField
        v-model="permission"
        :label="$t('dialogs.shareAccountDialog.permissionLabel')"
        :values="permissionOptions"
        label-key="label"
        value-key="value"
      />

      <template v-if="showsWriteScope">
        <SelectField
          v-model="writeScope"
          :label="$t('dialogs.shareAccountDialog.writeScopeLabel')"
          :values="writeScopeOptions"
          label-key="label"
          value-key="value"
        />
      </template>

      <div class="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" :disabled="mutation.isPending.value" @click="isOpen = false">
          {{ $t('dialogs.shareAccountDialog.cancel') }}
        </Button>
        <DemoRestricted feature="share_account_dialog_submit">
          <Button type="submit" :disabled="!canSubmit || isDemo" :loading="mutation.isPending.value">
            {{ $t('dialogs.shareAccountDialog.send') }}
          </Button>
        </DemoRestricted>
      </div>
    </form>
  </ResponsiveDialog>
</template>
