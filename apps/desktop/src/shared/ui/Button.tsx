import * as React from 'react';
import { Button as UiButton } from '@/shared/ui/primitives/button';
import { bumaButtonClass, type BumaButtonProps } from '@/shared/ui/buma/Button';
import { cn } from '@/shared/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'light';

/**
 * The app's button: always the BUMA Design System button (shared/ui/buma/Button.tsx), exactly as the
 * Vue source draws it. `primary` and `light` are BUMA primary (approve); `secondary` and `ghost` are
 * BUMA secondary. The BUMA look wins over a caller's className (size, padding, radius, colors), so only
 * layout classes (margins, flex, width) take effect. Built on the shadcn button so `asChild` keeps working.
 */
const MAP: Record<ButtonVariant, { variant: 'default' | 'secondary'; buma: BumaButtonProps['variant'] }> = {
  primary: { variant: 'default', buma: 'primary' },
  light: { variant: 'default', buma: 'primary' },
  secondary: { variant: 'secondary', buma: 'secondary' },
  ghost: { variant: 'secondary', buma: 'secondary' },
};

export interface ButtonProps extends Omit<React.ComponentProps<typeof UiButton>, 'variant'> {
  variant?: ButtonVariant;
  /** BUMA modifiers. */
  condition?: BumaButtonProps['condition'];
  outline?: boolean;
  small?: boolean;
  block?: boolean;
  pill?: boolean;
  iconOnly?: boolean;
}

export function Button({ variant = 'primary', condition, outline, small, block, pill, iconOnly, size, className, ...props }: ButtonProps) {
  const m = MAP[variant];
  const icon = iconOnly ?? (typeof size === 'string' && size.startsWith('icon'));
  const buma = bumaButtonClass({ variant: m.buma, condition, outline, small, block, pill, iconOnly: icon });
  return <UiButton variant={m.variant} className={cn(className, buma)} {...props} />;
}
