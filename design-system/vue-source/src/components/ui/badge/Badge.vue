<template>
  <div
    :class="badgeClass"
    data-testId="badge"
  >
    <slot>
      <span>{{ label }}</span>
    </slot>
  </div>
</template>

<script setup lang="ts">
/* es-disable no-undef */
import { computed } from 'vue'
import type { BadgeProps } from '@/components/ui/badge/types/badge'
import { merge } from '@/core/helpers/class'

const props = withDefaults(defineProps<BadgeProps>(), {
  label: 'Badge',
  variant: 'success',
  reverse: false,
  block: false
})

const badgeClass = computed(() => {
  return merge([
    'b-badge',
    props.reverse ? 'reverse' : '',
    `b-badge--${props.variant}`,
    props.block ? 'b-badge--block' : ''
  ])
})
</script>
<style scoped lang="scss">
@import './style/badge.scss';
</style>
