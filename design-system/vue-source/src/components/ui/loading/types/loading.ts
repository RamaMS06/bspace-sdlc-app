export interface loadingProps {
  /**
   * Loading variant
   */
  variant?: 'data' | 'sync' | 'refresh' | 'process' | 'chart'
  /**
   * Loading label
   */
  label?: boolean
  /**
   * Custom label text (default: "Loading")
   */
  labelText?: string
  /**
   * Custom animation data to override variant mapping
   */
  animationData?: unknown
  /**
   * Auto play animation
   */
  autoPlay?: boolean
  /**
   * Loop animation
   */
  loop?: boolean
  /**
   * Playback speed (1 = normal)
   */
  speed?: number
  /**
   * Playback direction (1 forward, -1 reverse)
   */
  direction?: 1 | -1
  /**
   * Play specific segment(s)
   */
  segments?: [number, number] | Array<[number, number]>
  /**
   * Explicit width for the animation (overrides CSS), e.g., 24 or "24px"
   */
  width?: number | string
  /**
   * Explicit height for the animation (overrides CSS), e.g., 24 or "24px"
   */
  height?: number | string
  /**
   * Square size applied to both width and height (overrides width/height)
   */
  size?: number | string
  /**
   * Extra class applied to the animation element
   */
  extraClass?: string
  /**
   * Tint fill color for SVG paths (e.g., "#0ea5e9")
   */
  color?: string
  /**
   * Tint stroke color for SVG strokes (e.g., "#0ea5e9")
   */
  strokeColor?: string
  /**
   * Lottie renderer type (svg | canvas | html), default svg
   */
  renderer?: 'svg' | 'canvas' | 'html'
}
