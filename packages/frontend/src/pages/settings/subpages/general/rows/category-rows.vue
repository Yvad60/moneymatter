<template>
  <SettingRow
    :label="$t('settings.general.savingsCategories.label')"
    :description="$t('settings.general.savingsCategories.description')"
    docs-path="/stats/how-stats-are-calculated/#savings-categories"
  >
    <!-- The field's own root is w-full, so the width lives on a wrapper instead of its class. -->
    <div class="w-64 shrink-0">
      <CategoryMultiSelectField
        :model-value="savingsCategoryIds"
        :disabled="isUpdating"
        @update:model-value="handleSavingsCategoriesChange"
      />
    </div>
  </SettingRow>

  <Separator />

  <SettingRow
    :label="$t('settings.general.taxCategories.label')"
    :description="$t('settings.general.taxCategories.description')"
  >
    <div class="w-64 shrink-0">
      <CategoryMultiSelectField
        :model-value="taxCategoryIds"
        :disabled="isUpdating"
        @update:model-value="handleTaxCategoriesChange"
      />
    </div>
  </SettingRow>

  <Separator />

  <SettingRow
    :label="$t('settings.general.incomeCategories.label')"
    :description="$t('settings.general.incomeCategories.description')"
  >
    <div class="w-64 shrink-0">
      <CategoryMultiSelectField
        :model-value="incomeCategoryIds"
        :disabled="isPatching"
        @update:model-value="handleIncomeCategoriesChange"
      />
    </div>
  </SettingRow>

  <SettingRow
    class="pl-4"
    :class="{ 'opacity-60': !incomeCategoryIds.length }"
    :label="$t('settings.general.filterCategoriesByType.label')"
    :description="$t('settings.general.filterCategoriesByType.description')"
  >
    <Switch
      :model-value="filterCategoriesByType"
      :disabled="isPatching || !userSettings || !incomeCategoryIds.length"
      @update:model-value="handleFilterCategoriesByTypeToggle"
    />
  </SettingRow>
</template>

<script setup lang="ts">
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import CategoryMultiSelectField from '@/components/fields/category-multi-select-field.vue';
import { Separator } from '@/components/lib/ui/separator';
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
const { data: userSettings, mutateAsync, isUpdating, patchAsync, isPatching } = useUserSettings();

const savingsCategoryIds = computed(() => userSettings.value?.savingsCategoryIds ?? []);
const taxCategoryIds = computed(() => userSettings.value?.taxCategoryIds ?? []);
const incomeCategoryIds = computed(() => userSettings.value?.incomeCategoryIds ?? []);
const filterCategoriesByType = computed(
  () => userSettings.value?.ui?.transactionForm?.filterCategoriesByType !== false,
);

const handleSavingsCategoriesChange = async (value: string[]) => {
  try {
    await mutateAsync({
      ...userSettings.value,
      savingsCategoryIds: value,
    });

    addSuccessNotification(t('settings.general.savingsCategories.successNotification'));

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsCashFlow] }),
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.widgetCashFlow] }),
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.widgetCashFlowPrev] }),
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.widgetCashFlowTrend] }),
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.fireCashFlow] }),
    ]);
  } catch {
    addErrorNotification(t('settings.general.savingsCategories.errorNotification'));
  }
};

const handleTaxCategoriesChange = async (value: string[]) => {
  try {
    await mutateAsync({
      ...userSettings.value,
      taxCategoryIds: value,
    });

    addSuccessNotification(t('settings.general.taxCategories.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.taxCategories.errorNotification'));
  }
};

const handleIncomeCategoriesChange = async (value: string[]) => {
  try {
    await patchAsync({ incomeCategoryIds: value });

    addSuccessNotification(t('settings.general.incomeCategories.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.incomeCategories.errorNotification'));
  }
};

const handleFilterCategoriesByTypeToggle = async (value: boolean) => {
  try {
    await patchAsync({ ui: { transactionForm: { filterCategoriesByType: value } } });
    addSuccessNotification(t('settings.general.filterCategoriesByType.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.filterCategoriesByType.errorNotification'));
  }
};
</script>
