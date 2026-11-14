<template>
  <svg 
    :width="parseFloat(width as string) * parseFloat(scale as string)"
    :height="parseFloat(height as string) * parseFloat(scale as string)" 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z"
      :fill="fill"
    />
    <path
      d="M7.74 9H16.27C16.54 9 16.76 8.78 16.76 8.51V8.49C16.76 8.22 16.54 8 16.27 8H16C16 6.52 15.19 5.25 14 4.55V5.5C14 5.78 13.78 6 13.5 6C13.22 6 13 5.78 13 5.5V4.14C12.68 4.06 12.35 4 12 4C11.65 4 11.32 4.06 11 4.14V5.5C11 5.78 10.78 6 10.5 6C10.22 6 10 5.78 10 5.5V4.55C8.81 5.25 8 6.52 8 8H7.74C7.47 8 7.25 8.22 7.25 8.49V8.52C7.25 8.78 7.47 9 7.74 9Z"
      :fill="fill"
    />
    <path
      d="M12 13C13.86 13 15.41 11.72 15.86 10H8.14C8.59 11.72 10.14 13 12 13Z"
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

  