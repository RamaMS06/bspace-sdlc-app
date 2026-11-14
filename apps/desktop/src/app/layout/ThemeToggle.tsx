import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toggleTheme, useTheme } from '@/shared/lib/theme';

/** The light / dark switch: in the status bar of the app and in the footer of every onboarding screen. */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const label = resolved === 'dark' ? t('theme.toLight') : t('theme.toDark');
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={toggleTheme}
      className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-raised/50 hover:text-foreground"
    >
      {resolved === 'dark' ? <Sun size={13} aria-hidden="true" /> : <Moon size={13} aria-hidden="true" />}
    </button>
  );
}
