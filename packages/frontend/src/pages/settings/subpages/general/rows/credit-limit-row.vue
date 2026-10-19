<template>
  <SettingRow
    :label="$t('settings.general.creditLimit.label')"
    :description="$t('settings.general.creditLimit.description')"
    docs-path="/settings/general-settings/#include-credit-limits-in-balance"
  >
    <Switch
      :model-value="includeCreditLimitInStats"
      :disabled="isUpdating"
      @update:model-value="handleCreditLimitToggle"
    />
  </SettingRow>
</template>

<script setup lang="ts">
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { Switch } from '@/components/lib/ui/switch';
import { useNotificationCenter } from '@/components/notification-center';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import SettingRow from './setting-row.vue';

const { t } = useI18n();
const queryClient = useQueryClient();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { data: userSettings, mutateAsync, isUpdating } = useUserSettings();

const includeCreditLimitInStats = computed(() => userSettings.value?.includeCreditLimitInStats ?? false);

const handleCreditLimitToggle = async (value: boolean) => {
  try {
    await mutateAsync({
      ...userSettings.value,
      includeCreditLimitInStats: value,
    });

    addSuccessNotification(t('settings.general.creditLimit.successNotification'));

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.widgetBalanceTrend] }),
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.widgetBalanceTrendPrev] }),
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.widgetBalanceTotalBalance] }),
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.widgetBalancePreviousBalance] }),
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsBalanceHistoryTrend] }),
    ]);
  } catch {
    addErrorNotification(t('settings.general.creditLimit.errorNotification'));
  }
};
</script>
