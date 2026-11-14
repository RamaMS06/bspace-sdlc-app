<template>
  <div
    class="b-chips"
    :class="chipClass"
    data-testId="chips"
    @click="onClick()"
  >
    <slot>{{ label }}</slot>
    <BIcon
      v-if="removable && !disabled"
      name="Cancel"
      data-testId="chipsRemove"
      :class="iconClass"
      @click="emits('remove')"
    />
  </div>
</template>

<script setup lang="ts">
 
import { computed } from 'vue'
import type { ChipProps } from '@/components/ui/chips/types/chips'
import BIcon from '@/components/ui/icon/Icon.vue'

const props = withDefaults(defineProps<ChipProps>(), {
  label: 'Chips',
  variant: 'primary',
  small: false,
  disabled: false
})

const chipClass = computed(() => {
  return [
    `b-chips--${props.variant}`,
    props.disabled ? 'disabled' : '',
    props.small ? 'b-chips--small' : ''
  ]
})

const onClick = () => {
  if (!props.disabled) {
    emits('click')
  }
}

const iconClass = computed(() => {
  return [props.label ? 'b-chips--icon' : 'b-chips--icon-without-text']
})

const emits = defineEmits(['remove', 'click'])
</script>
<style scoped lang="scss">
@import './style/chips.scss';
</style>
