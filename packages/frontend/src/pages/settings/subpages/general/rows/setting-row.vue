<template>
  <div class="flex flex-wrap items-center justify-between gap-4">
    <div class="min-w-48 flex-1">
      <div :id="labelId" class="text-sm font-medium">
        {{ label }}
      </div>
      <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
        {{ description }}
        <DocsLink v-if="docsPath" :path="docsPath" />
      </p>
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
import DocsLink from '@/components/common/docs-link.vue';

defineProps<{
  label: string;
  description: string;
  docsPath?: string;
  labelId?: string;
}>();
</script>
