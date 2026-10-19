<template>
  <Button type="button" variant="outline" class="relative w-full gap-2" :disabled="isLoading" @click="handleClick">
    <KeyRoundIcon class="size-5" />
    <span>{{ buttonText }}</span>
    <LastUsedBadge v-if="isLastUsed" class="absolute -top-2.25 right-2.5" />
  </Button>
</template>

<script lang="ts" setup>
import LastUsedBadge from '@/components/auth/last-used-badge.vue';
import { Button } from '@/components/lib/ui/button';
import { KeyRoundIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

interface Props {
  mode?: 'signin' | 'register';
  isLoading?: boolean;
  isLastUsed?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'signin',
  isLoading: false,
});

const emit = defineEmits<{
  click: [];
}>();

const buttonText = computed(() => {
  return props.mode === 'register' ? t('auth.shared.passkeyButton.register') : t('auth.shared.passkeyButton.signIn');
});

const handleClick = () => {
  emit('click');
};
</script>
