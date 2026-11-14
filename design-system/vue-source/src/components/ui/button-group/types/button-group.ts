export interface ButtonGroupProps {


  /**
   * Array of button items to be rendered in the group
   */
  items: ButtonGroupItemProps[]
}

export interface ButtonGroupItemProps {
  /**
   * The text label for the button
   */
  label: string

  /**
   * Whether the button is clickable
   * @default true
   */
  clickable?: boolean

  /**
   * Click handler for the button
   */
  click?: () => void

  /**
   * Whether the button is disabled
   * @default false
   */
  disabled?: boolean

  /**
   * Icon name to display in the button
   */
  icon?: string

  /**
   * Button variant
   * @default 'primary'
   */
  variant?: 'primary' | 'secondary' | 'tertiary'
}
