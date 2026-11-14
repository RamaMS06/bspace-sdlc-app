<template>
  <button
    class="button"
    :class="classes"
    :disabled="disabled"
    data-testId="buttonLink"
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
import type { ButtonProps } from '@/components/ui/button-link/types/button-link'

const props = withDefaults(defineProps<ButtonProps>(), {
  label: 'Button',
  variant: 'primary',
  disabled: false
})

const classes = computed(() => {
  return [
    props.modifier && props.variant === 'secondary'
      ? `button--${props.variant}-${props.modifier}`
      : `button--${props.variant}`,
    props.disabled ? 'button--disabled' : ''
  ]
})

const emit = defineEmits(['click'])

const onClick = () => {
  emit('click')
}
</script>

<style lang="scss">
@import './style/button-link.scss';
</style>
