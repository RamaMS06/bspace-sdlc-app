<template>
  <div
    data-testId="button-group"
    class="b-btn-group"
    :class="buttonGroupClass"
  >
    <BButton
      v-for="(item, index) in items"
      :key="`${item.label}-${index}`"
      :label="item.label"
      :variant="item.variant"
      :disabled="item.disabled"
      :icon="item.icon"
      :class="getButtonClass(item)"
      @click="handleClick(item, index)"
    >
      <template
        v-for="(_, name) in $slots"
        :key="name"
        #[name]="slotData"
      >
        <slot
          :name="name"
          v-bind="slotData"
          :item="item"
          :index="index"
        >
          <BLabel>{{ item.label }}</BLabel>
          <BIcon name="person" />
        </slot>
      </template>
    </BButton>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import type { ButtonGroupProps } from '@/components/ui/button-group/types/button-group'
import BButton from '@/components/ui/button/Button.vue'
import BLabel from '@/components/ui/label/Label.vue'
import BIcon from '@/components/ui/icon/Icon.vue'

defineProps<ButtonGroupProps>()

const emit = defineEmits(['click'])

const buttonGroupClass = computed(() => {
  return ['b-btn-group', 'b-btn-group--joined']
})

const getButtonClass = (item: ButtonGroupProps['items'][0]) => {
  return {
    'b-btn--no-shadow': item.clickable === false
  }
}

const handleClick = (item: ButtonGroupProps['items'][0], index: number) => {
  if (item.clickable !== false) {
    item.click?.()
    emit('click', { item, index })
  }
}
</script>

<style lang="scss">
@import './style/button-group.scss';

.b-btn--no-shadow {
  box-shadow: none !important;
  &:hover {
    box-shadow: none !important;
  }
}
</style>
