<template>
  <button
    data-testId="button"
    class="b-btn"
    :class="classes"
    :disabled="disabled"
    @click="onClick()"
  >
    <slot>
      <span v-if="label">
        {{ label }}
      </span>
    </slot>
  </button>
</template>

<script lang="ts" setup>
 
import { computed } from 'vue'
import type { ButtonProps } from '@/components/ui/button/types/button'

const props = withDefaults(defineProps<ButtonProps>(), {
  label: 'Button',
  variant: 'primary',
  condition: 'approve',
  outline: false,
  disabled: false,
  small: false,
  pill: false
})

const outlinePrefix = computed(() =>
  props.outline && (props.variant === 'primary' || props.variant === 'secondary') ? '-outline' : ''
)
const variantClass = computed(() => {
  if (props.variant === 'primary') {
    return `b-btn${outlinePrefix.value}-${props.variant}--${props.condition}`
  } else {
    return `b-btn${outlinePrefix.value}-${props.variant}`
  }
})
const conditionClass = computed(() =>
  !props.outline && props.condition && props.variant == 'primary' ? `b-btn-${props.condition}` : ''
)
const smallClass = computed(() => (props.small ? 'b-btn-sm' : ''))
const blockClass = computed(() => (props.block ? 'b-btn-block' : ''))
const pillClass = computed(() => (props.pill ? 'b-btn-pill' : ''))
const iconOnly = computed(() => (props.iconOnly && props.variant !== 'hover-card' ? 'b-btn-icon-only' : ''))

const classes = computed(() => {
  return [
    iconOnly.value,
    variantClass.value,
    conditionClass.value,
    smallClass.value,
    blockClass.value,
    pillClass.value
  ]
})

const emit = defineEmits(['click'])

const onClick = () => {
  emit('click')
}
</script>

<style lang="scss">
@import './style/button.scss';
</style>
