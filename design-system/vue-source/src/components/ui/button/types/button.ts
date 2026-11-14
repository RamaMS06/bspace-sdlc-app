export interface ButtonProps {
  /**
   * Button label
   */
  label?: string
  /**
   * Button Variant
   */
  variant?:
    | 'primary'
    | 'secondary'
    | 'secondary-white'
    | 'tertiary'
    | 'hover-card'
  /**
   * Button condition
   *
   * This props only can use with variant primary
   */
  condition?: 'approve' | 'reject' | 'revise' | 'outstanding'
  /**
   * Make button outline style
   */
  outline?: boolean
  /**
   * Disabled button
   */
  disabled?: boolean
  /**
   * Small button
   */
  small?: boolean
  /**
   * Block button
   */
  block?: boolean
  /**
   * Pill button
   */
  pill?: boolean

  iconOnly?: boolean
}
