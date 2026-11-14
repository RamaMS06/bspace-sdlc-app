<template>
  <div
    v-if="variant === 'paragraph' || variant === 'paragraph-indent'"
    :class="labelClass"
    data-testId="label"
  >
    <slot>{{ label }}</slot>
    <span
      v-if="required"
      class="required-symbol"
    >*</span>
  </div>
  <span
    v-else
    :class="labelClass"
    data-testId="label"
  >
    <slot>{{ label }}</slot>
    <span
      v-if="required"
      class="required-symbol"
    >*</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LabelProps } from '@/components/ui/label/types/label'

const props = withDefaults(defineProps<LabelProps>(), {
  label: 'Label',
  variant: 'body'
})

const labelClass = computed(() => {
  return [
    'b-label',
    `text-format-${props.variant}`,
    props.error ? 'text-danger-500' : '',
    props.lightdark ? 'text-lightdark' : ''
  ]
})
</script>

<style scoped lang="scss">
@import './style/label.scss';
</style>
