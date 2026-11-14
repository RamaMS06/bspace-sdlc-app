<template>
  <svg
    :width="parseFloat(width as string) * parseFloat(scale as string)"
    :height="parseFloat(height as string) * parseFloat(scale as string)"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M6.03 12.0296L8.03 15.4996L5.5 18.6796L2 12.6196L6.03 12.0296ZM17 17.9996V15.2896C17.88 14.8996 18.5 14.0296 18.5 12.9996C18.5 12.4296 18.3 11.8996 17.97 11.4996L19.94 10.3496C20.95 9.75959 21.3 8.46959 20.71 7.45959L19.33 5.05959C19.0486 4.57459 18.587 4.22046 18.0456 4.07436C17.5043 3.92826 16.9272 4.00202 16.44 4.27959L8.31 8.99959C7.36 9.52959 7.03 10.7496 7.58 11.7096L9.08 14.3096C9.63 15.2596 10.86 15.5896 11.81 15.0396L13.69 13.9596C13.94 14.5496 14.41 15.0296 15 15.2896V17.9996C15 19.0996 15.9 19.9996 17 19.9996H22V17.9996H17Z"
      :fill="fill"
    />
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    width?: string | number
    height?: string | number
    size?: string | number
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
