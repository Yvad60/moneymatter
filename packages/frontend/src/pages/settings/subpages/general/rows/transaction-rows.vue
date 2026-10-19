<template>
  <SettingRow
    :label="$t('settings.general.showUpcomingTransactions.label')"
    :description="$t('settings.general.showUpcomingTransactions.description')"
  >
    <Switch
      :model-value="showUpcomingTransactions"
      :disabled="isPatching"
      @update:model-value="handleShowUpcomingToggle"
    />
  </SettingRow>

  <Separator />

  <SettingRow
    :label="$t('settings.general.defaultPaymentType.label')"
    :description="$t('settings.general.defaultPaymentType.description')"
  >
    <div class="w-64 shrink-0">
      <SelectField
        :model-value="defaultPaymentType"
        :values="VERBOSE_PAYMENT_TYPES"
        :label-key="(item) => $t(item.label)"
        :placeholder="$t('settings.general.defaultPaymentType.placeholder')"
        :disabled="isDefaultPaymentTypeUpdating || !userSettings"
        @update:model-value="handleDefaultPaymentTypeChange"
      />
    </div>
  </SettingRow>

  <Separator />

  <div class="flex flex-col gap-3">
    <div>
      <div class="text-sm font-medium">
        {{ $t('settings.general.transactionFields.label') }}
      </div>
      <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
        {{ $t('settings.general.transactionFields.description') }}
      </p>
    </div>

    <div class="divide-y rounded-md border">
      <template v-for="field in TRANSACTION_OPTIONAL_FIELDS" :key="field">
        <SettingRow
          class="px-4 py-3"
          :label="$t(`settings.general.transactionFields.fields.${field}.label`)"
          :description="$t(`settings.general.transactionFields.fields.${field}.description`)"
        >
          <Switch
            :model-value="isOptionalFieldEnabled(field)"
            :disabled="isOptionalFieldsUpdating || !userSettings"
            @update:model-value="(value) => handleOptionalFieldToggle({ field, value })"
          />
        </SettingRow>

        <SettingRow
          v-if="field === 'location'"
          class="py-3 pr-4 pl-8"
          :class="{ 'opacity-60': !isOptionalFieldEnabled('location') }"
          :label="$t('settings.general.transactionFields.mapPicker.label')"
          :description="$t('settings.general.transactionFields.mapPicker.description')"
        >
          <Switch
            :model-value="isMapPickerEnabled"
            :disabled="isMapPickerUpdating || !userSettings || !isOptionalFieldEnabled('location')"
            @update:model-value="handleMapPickerToggle"
          />
        </SettingRow>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { VERBOSE_PAYMENT_TYPES, type VerbosePaymentType } from '@/common/const';
import { useDefaultPaymentType } from '@/components/dialogs/manage-transaction/composables/use-default-payment-type';
import { useMapPickerSetting } from '@/components/dialogs/manage-transaction/composables/use-map-picker-setting';
import { useOptionalFields } from '@/components/dialogs/manage-transaction/composables/use-optional-fields';
import SelectField from '@/components/fields/select-field.vue';
import { Separator } from '@/components/lib/ui/separator';
import { Switch } from '@/components/lib/ui/switch';
import { useNotificationCenter } from '@/components/notification-center';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { TRANSACTION_OPTIONAL_FIELDS, type TransactionOptionalField } from '@bt/shared/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import SettingRow from './setting-row.vue';

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { data: userSettings, patchAsync, isPatching } = useUserSettings();

const {
  isEnabled: isOptionalFieldEnabled,
  setEnabled: setOptionalField,
  isUpdating: isOptionalFieldsUpdating,
} = useOptionalFields();

const { defaultPaymentType, setDefaultPaymentType, isUpdating: isDefaultPaymentTypeUpdating } = useDefaultPaymentType();

const {
  enabled: isMapPickerEnabled,
  setEnabled: setMapPicker,
  isUpdating: isMapPickerUpdating,
} = useMapPickerSetting();

const showUpcomingTransactions = computed(() => !userSettings.value?.ui?.transactionsList?.hideUpcoming);

const handleShowUpcomingToggle = async (value: boolean) => {
  try {
    await patchAsync({ ui: { transactionsList: { hideUpcoming: !value } } });
    addSuccessNotification(t('settings.general.showUpcomingTransactions.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.showUpcomingTransactions.errorNotification'));
  }
};

const handleDefaultPaymentTypeChange = async (item: VerbosePaymentType | null) => {
  if (!item) return;
  try {
    await setDefaultPaymentType({ value: item.value });
    addSuccessNotification(t('settings.general.defaultPaymentType.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.defaultPaymentType.errorNotification'));
  }
};

const handleOptionalFieldToggle = async ({ field, value }: { field: TransactionOptionalField; value: boolean }) => {
  try {
    await setOptionalField({ field, value });
    addSuccessNotification(t('settings.general.transactionFields.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.transactionFields.errorNotification'));
  }
};

const handleMapPickerToggle = async (value: boolean) => {
  try {
    await setMapPicker({ value });
    addSuccessNotification(t('settings.general.transactionFields.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.transactionFields.errorNotification'));
  }
};
</script>
