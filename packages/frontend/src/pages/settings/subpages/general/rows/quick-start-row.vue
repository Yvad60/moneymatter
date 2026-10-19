<template>
  <SettingRow
    :label="$t('settings.general.quickStart.label')"
    :description="$t('settings.general.quickStart.description')"
  >
    <Switch
      :model-value="!isDismissed"
      :disabled="!isInitialized"
      @update:model-value="(value) => (value ? onboardingStore.reopen() : onboardingStore.dismissPermanently())"
    />
  </SettingRow>
</template>

<script setup lang="ts">
import { Switch } from '@/components/lib/ui/switch';
import { useOnboardingStore } from '@/stores/onboarding';
import { storeToRefs } from 'pinia';

import SettingRow from './setting-row.vue';

const onboardingStore = useOnboardingStore();
const { isDismissed, isInitialized } = storeToRefs(onboardingStore);
</script>
