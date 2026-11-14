export interface ButtonProps {
  /**
   * Button label. When the text is passed through the label prop, it will automatically have an underline on hover. However, if you want to use a slot, you need to wrap the content in a span element.
   */
  label?: string
  /**
   * Button Variant
   */
  variant?: 'primary' | 'secondary'
  /**
   * Button disable
   */
  modifier?: 'dark' | 'white'
  disabled?: boolean
}
