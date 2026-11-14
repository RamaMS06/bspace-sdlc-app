<template>
  <svg 
    :width="parseFloat(width as string) * parseFloat(scale as string)"
    :height="parseFloat(height as string) * parseFloat(scale as string)" 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M4 20V4H6V20H4ZM11 20V16H13V20H11ZM18 20V4H20V20H18ZM11 14V10H13V14H11ZM11 8V4H13V8H11Z"
      :fill="fill"
    />
  </svg>
</template>

<script setup lang="ts">
 
withDefaults(
  defineProps<{
    width?: string | number
    height?: string | number
    scale?: string | number
    fill?: string
  }>(),
  {
    width: 24,
    height: 24,
    scale: 1,
    fill: 'currentColor'
  }
)
</script>

  