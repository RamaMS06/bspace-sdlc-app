export interface ChipProps {
  /**
   * Chip label
   */
  label?: string
  /**
   * Chip Variant
   * Default Primary
   */
  variant?: 'primary' | 'secondary' | 'outline' | 'color'
  /**
   * Chip Small change Size
   */
  small?: boolean
  /**
   * Remove Chip
   */
  removable?: boolean
  /**
   * Disable Chip
   */
  disabled?: boolean
}
