<template>
  <div class="b-loader">
    <LottiePlayer
      ref="refLoading"
      :animation-data="selectedAnimation"
      :loop="loop"
      :auto-play="autoPlay"
      :speed="speed"
      :direction="String(direction)"
      :segments="segments"
      :height="stringHeight"
      :width="stringWidth"
      :renderer="renderer"
      :style="[sizeStyle, colorVars]"
      :class="[classes, extraClass]"
      data-testId="loading"
      @on-animation-created="handleAnimationCreated"
    />
    <p
      v-if="label"
      class="text-format-body b-loader__label"
      data-testId="loadingLabel"
    >
      {{ computedLabel }}<span class="dots" />
    </p>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { loadingProps } from '@/components/ui/loading/types/loading'
import { Vue3Lottie as LottiePlayer } from 'vue3-lottie'
import { CHART_LOAD, DATA_LOAD, PAGE_PROCESS, REFRESH, SYNC_DATA } from '@/components/ui/loading/assets/lottie/index'

const props = withDefaults(defineProps<loadingProps>(), {
  label: true,
  variant: 'data',
  labelText: 'Loading',
  autoPlay: true,
  loop: true,
  speed: 1,
  direction: 1,
  renderer: 'svg',
  size: 40,
  color:"#08A94C",
  strokeColor:"#08A94C"
})

const selectedAnimation = computed(() => {
  if (props.animationData) return props.animationData
  switch (props.variant) {
    case 'data': {
      return DATA_LOAD
    }
    case 'sync': {
      return SYNC_DATA
    }
    case 'chart': {
      return CHART_LOAD
    }
    case 'refresh': {
      return REFRESH
    }
    case 'process': {
      return PAGE_PROCESS
    }
    default: {
      return DATA_LOAD
    }
  }
})

const classes = computed(() => {
  return [`b-loader__animation--${props.variant} my-auto`]
})

const computedLabel = computed(() => props.labelText || 'Loading')

const refLoading = ref<any>(null)
const lottieInstance = ref<any>(null)

function play() {
  refLoading.value?.play?.()
}
function pause() {
  refLoading.value?.pause?.()
}
function stop() {
  refLoading.value?.stop?.()
}
function goToAndPlay(frameOrTime: number, isFrame = true) {
  refLoading.value?.goToAndPlay?.(frameOrTime, isFrame)
}
function goToAndStop(frameOrTime: number, isFrame = true) {
  refLoading.value?.goToAndStop?.(frameOrTime, isFrame)
}

const toCssSize = (v?: number | string) => {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'number') return `${v}px`
  const trimmed = String(v).trim()
  // if string numeric like "11" → add px
  if (/^\d+$/.test(trimmed)) return `${trimmed}px`
  return trimmed
}
const stringSize = computed(() => toCssSize(props.size))
const stringWidth = computed(() => stringSize.value || toCssSize(props.width))
const stringHeight = computed(() => stringSize.value || toCssSize(props.height))
const sizeStyle = computed(() => {
  const style: Record<string, string> = {}
  if (stringSize.value) {
    style.width = stringSize.value as string
    style.height = stringSize.value as string
  } else {
    if (stringWidth.value) style.width = stringWidth.value as string
    if (stringHeight.value) style.height = stringHeight.value as string
  }
  return style
})
const colorVars = computed(() => {
  const style: Record<string, string> = {}
  if (props.color) style['--b-loader-fill'] = props.color
  if (props.strokeColor) style['--b-loader-stroke'] = props.strokeColor
  return style
})

function applyColorToSvg() {
  if (props.renderer !== 'svg') return
  const rootEl = refLoading.value?.$el as HTMLElement | undefined
  if (!rootEl) return
  const svg = rootEl.querySelector('svg')
  if (!svg) return
  if (props.color) {
    const paths = svg.querySelectorAll<SVGPathElement>('[fill]:not([fill="none"])')
    paths.forEach((p) => p.setAttribute('fill', props.color as string))
    const shapes = svg.querySelectorAll<SVGElement>('*[style*="fill:"]')
    shapes.forEach((el) => {
      const style = el.getAttribute('style') || ''
      el.setAttribute('style', style.replace(/fill:\s*[^;]+/g, `fill: ${props.color}`))
    })
  }
  if (props.strokeColor) {
    const strokes = svg.querySelectorAll<SVGPathElement>('[stroke]:not([stroke="none"])')
    strokes.forEach((p) => p.setAttribute('stroke', props.strokeColor as string))
    const shapes = svg.querySelectorAll<SVGElement>('*[style*="stroke:"]')
    shapes.forEach((el) => {
      const style = el.getAttribute('style') || ''
      el.setAttribute('style', style.replace(/stroke:\s*[^;]+/g, `stroke: ${props.strokeColor}`))
    })
  }
}

// Try to recolor once component is mounted and when relevant props change
import { onMounted, watch, nextTick } from 'vue'
onMounted(() => {
  // allow lottie to render svg
  setTimeout(() => applyColorToSvg(), 50)
})
watch(
  () => [props.color, props.strokeColor, props.renderer, selectedAnimation.value],
  async () => {
    await nextTick()
    // small delay to wait DOM update of lottie
    setTimeout(() => applyColorToSvg(), 20)
  }
)

function handleAnimationCreated(anim: any) {
  lottieInstance.value = anim
  // When the SVG DOM is ready
  anim.addEventListener?.('DOMLoaded', () => {
    // next tick to ensure in-DOM
    setTimeout(() => applyColorToSvg(), 10)
  })
  // Also try on complete (some assets adjust styles mid-run)
  anim.addEventListener?.('complete', () => {
    setTimeout(() => applyColorToSvg(), 0)
  })
}

defineExpose({
  play,
  pause,
  stop,
  goToAndPlay,
  goToAndStop
})
</script>

<style scoped lang="scss">
@import './style/loading.scss';

/* Force color override via CSS variables, even when attributes are set */
:deep(svg [fill]) {
  fill: var(--b-loader-fill) !important;
}
:deep(svg [stroke]) {
  stroke: var(--b-loader-stroke) !important;
}
:deep(svg *[style*='fill:']) {
  fill: var(--b-loader-fill) !important;
}
:deep(svg *[style*='stroke:']) {
  stroke: var(--b-loader-stroke) !important;
}
</style>
