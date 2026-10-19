<template>
  <SettingRow
    :label="$t('settings.general.accountDropdowns.defaultAccount.label')"
    :description="$t('settings.general.accountDropdowns.defaultAccount.description')"
  >
    <AccountSelectField
      class="w-64 shrink-0"
      :model-value="defaultAccount"
      :accounts="activeSourceAccounts"
      :placeholder="$t('settings.general.accountDropdowns.defaultAccount.placeholder')"
      :disabled="isUpdating"
      clearable
      @update:model-value="handleDefaultAccountChange"
    />
  </SettingRow>

  <Separator />

  <SettingRow
    :label="$t('settings.general.accountDropdowns.showArchived.label')"
    :description="$t('settings.general.accountDropdowns.showArchived.description')"
  >
    <Switch
      :model-value="showArchivedInDropdowns"
      :disabled="isUpdating"
      @update:model-value="handleShowArchivedToggle"
    />
  </SettingRow>
</template>

<script setup lang="ts">
import AccountSelectField from '@/components/fields/account-select-field.vue';
import { Separator } from '@/components/lib/ui/separator';
import { Switch } from '@/components/lib/ui/switch';
import { useNotificationCenter } from '@/components/notification-center';
import { filterDropdownAccounts, useAccountDropdownPrefs } from '@/composable/use-account-dropdown-prefs';
import { useAccountsStore } from '@/stores';
import type { AccountModel } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import SettingRow from './setting-row.vue';

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { accountsRecord, txTargetableSourceAccountsActiveFirst } = storeToRefs(useAccountsStore());
const { defaultAccountId, showArchivedInDropdowns, setDefaultAccountId, setShowArchivedInDropdowns, isUpdating } =
  useAccountDropdownPrefs();

const defaultAccount = computed<AccountModel | null>(() =>
  defaultAccountId.value ? (accountsRecord.value[defaultAccountId.value] ?? null) : null,
);
const activeSourceAccounts = computed(() =>
  filterDropdownAccounts({ accounts: txTargetableSourceAccountsActiveFirst.value, showArchived: false }),
);

const applyDropdownPref = async ({ update }: { update: () => Promise<unknown> }) => {
  try {
    await update();
    addSuccessNotification(t('settings.general.accountDropdowns.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.accountDropdowns.errorNotification'));
  }
};

const handleDefaultAccountChange = (account: AccountModel | null) =>
  applyDropdownPref({ update: () => setDefaultAccountId({ id: account?.id ?? null }) });

const handleShowArchivedToggle = (value: boolean) =>
  applyDropdownPref({ update: () => setShowArchivedInDropdowns({ value }) });
</script>
