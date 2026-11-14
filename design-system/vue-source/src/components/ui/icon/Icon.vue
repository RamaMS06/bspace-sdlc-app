<template>
  <component
    :is="isNonMaterialIcon && realName ? components[realName as keyof typeof components] : realName"
    v-if="isNonMaterialIcon"
    :fill="color"
    :width="size"
    :height="size"
  />
  <i
    v-else
    class="material-icons-round"
    :style="{ fontSize: props.size + 'px', color: props.color }"
  >
    {{ realName }}
  </i>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { camelToSnake, kebabToSnake, normalToSnake, pascalToSnake } from '@/core/helpers/string'
import { B_ICON_CUSTOM_NAMES } from '@/components/ui/icon/customIconNames'
import foggy from '@/components/ui/icon/monochrome/foggy.vue'
import rainy from '@/components/ui/icon/monochrome/rainy.vue'
import muslim from '@/components/ui/icon/monochrome/muslim.vue'
import inventory_box from '@/components/ui/icon/monochrome/inventory_box.vue'
import id_card from '@/components/ui/icon/monochrome/id_card.vue'
import calendar_clock from '@/components/ui/icon/monochrome/calendar_clock.vue'
import scan_delete from '@/components/ui/icon/monochrome/scan_delete.vue'
import user_engineer from '@/components/ui/icon/monochrome/user_engineer.vue'
import road from '@/components/ui/icon/monochrome/road.vue'
import view_document from '@/components/ui/icon/monochrome/view_document.vue'
import expand_circle_up from '@/components/ui/icon/monochrome/expand_circle_up.vue'
import hauler from '@/components/ui/icon/monochrome/hauler.vue'
import fuel_pump from '@/components/ui/icon/monochrome/fuel_pump.vue'
import cctv from '@/components/ui/icon/monochrome/cctv.vue'
import geology_crust from '@/components/ui/icon/monochrome/geology_crust.vue'
import speedometer from '@/components/ui/icon/monochrome/speedometer.vue'
import potholes from '@/components/ui/icon/monochrome/potholes.vue'
import loader from '@/components/ui/icon/monochrome/loader.vue'
import search_hands_free from '@/components/ui/icon/monochrome/search_hands_free.vue'
import file_attachment_pdf from '@/components/ui/icon/multiColor/FileAttachmentPdf.vue'
import file_attachment_doc from '@/components/ui/icon/multiColor/FileAttachmentDoc.vue'
import file_attachment_csv from '@/components/ui/icon/multiColor/FileAttachmentCsv.vue'
import file_attachment_ppt from '@/components/ui/icon/multiColor/FileAttachmentPpt.vue'
import file_attachment_xls from '@/components/ui/icon/multiColor/FileAttachmentXls.vue'
import file_attachment_jpg from '@/components/ui/icon/multiColor/FileAttachmentJpg.vue'
import file_attachment_png from '@/components/ui/icon/multiColor/FileAttachmentPng.vue'
import file_attachment_jpeg from '@/components/ui/icon/multiColor/FileAttachmentJpeg.vue'
import file_attachment_mov from '@/components/ui/icon/multiColor/FileAttachmentMov.vue'
import file_attachment_mp4 from '@/components/ui/icon/multiColor/FileAttachmentMp4.vue'
import file_attachment_heic from '@/components/ui/icon/multiColor/FileAttachmentHeic.vue'

const components = {
  foggy,
  rainy,
  muslim,
  inventory_box,
  id_card,
  calendar_clock,
  scan_delete,
  user_engineer,
  road,
  view_document,
  expand_circle_up,
  hauler,
  fuel_pump,
  cctv,
  geology_crust,
  speedometer,
  potholes,
  loader,
  search_hands_free,
  file_attachment_pdf,
  file_attachment_doc,
  file_attachment_csv,
  file_attachment_ppt,
  file_attachment_xls,
  file_attachment_jpg,
  file_attachment_png,
  file_attachment_jpeg,
  file_attachment_mov,
  file_attachment_mp4,
  file_attachment_heic
}

const props = withDefaults(
  defineProps<{
    name?: string
    color?: string
    size?: string | number
  }>(),
  {
    name: 'fiber-manual-record',
    size: '16'
  }
)

const realName = computed(() => {
  const convertTypeCase = checkTypeCase()
  return convertTypeCase
})

const checkTypeCase = () => {
  const str = props.name
  if (/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)+$/.test(str)) {
    return camelToSnake(str)
  } else if (/^[A-Z][a-zA-Z0-9]*$/.test(str)) {
    return pascalToSnake(str)
  } else if (/^[a-zA-Z][a-zA-Z0-9]*(\s+[a-zA-Z0-9]+)+$/.test(str)) {
    return normalToSnake(str)
  } else if (/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(str)) {
    return kebabToSnake(str)
  } else if (/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(str)) {
    return `${props.name}`
  } else {
    return
  }
}

const listIcon: string[] = [...B_ICON_CUSTOM_NAMES]

const isNonMaterialIcon = computed(() => listIcon.includes(realName.value ?? ''))
</script>
