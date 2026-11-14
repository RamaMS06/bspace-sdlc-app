<template>
  <svg
    :width="parseFloat(width as string) * parseFloat(scale as string)"
    :height="parseFloat(height as string) * parseFloat(scale as string)"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path 
      d="M4.58325 18.3337C4.24992 18.3337 3.95825 18.2087 3.70825 17.9587C3.45825 17.7087 3.33325 17.417 3.33325 17.0837V2.91699C3.33325 2.58366 3.45825 2.29199 3.70825 2.04199C3.95825 1.79199 4.24992 1.66699 4.58325 1.66699H12.1041L16.6666 6.22949V10.9587C16.4721 10.8753 16.2708 10.8094 16.0624 10.7607C15.8541 10.7121 15.6388 10.6739 15.4166 10.6462V6.79199H11.4791V2.91699H4.58325V17.0837H11.1666C11.3055 17.3198 11.4583 17.542 11.6249 17.7503C11.7916 17.9587 11.9791 18.1531 12.1874 18.3337H4.58325ZM13.2499 17.6253L12.3749 16.7503L14.1249 15.0003L12.3749 13.2503L13.2499 12.3753L14.9999 14.1253L16.7499 12.3753L17.6249 13.2503L15.8958 15.0003L17.6249 16.7503L16.7499 17.6253L14.9999 15.8962L13.2499 17.6253Z" 
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
