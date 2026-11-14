import { useTranslation } from 'react-i18next';
import bspaceLogo from '@/assets/brand/bspace-logo.png';
import bumaLogo from '@/assets/brand/buma-logo.png';
import { cn } from '@/lib/utils';

/** Top bar shared by the onboarding screens. The bar itself drags the window. */
/** Onboarding has this many steps; the last (signing in) is optional. */
export const ONBOARDING_STEPS = 4;

export function OnboardingHeader({ step, bars }: { step: 1 | 2 | 3 | 4; bars?: boolean }) {
  const { t } = useTranslation();
  return (
    <div data-tauri-drag-region className="flex items-center justify-between">
      {/* The logos are drawn for white, so in the dark theme they sit on a white plate. */}
      <div className="flex items-center gap-3 rounded-lg dark:bg-white dark:px-3 dark:py-2">
        {/* i18n-ignore: brand names */}
        <img src={bumaLogo} alt="BUMA" className="block h-6 w-auto" />
        <span aria-hidden="true" className="h-6 w-px bg-border dark:bg-[var(--buma-stroke-light)]" />
        {/* i18n-ignore: brand names */}
        <img src={bspaceLogo} alt="BSpace" className="block h-7 w-auto" />
      </div>
      <div className="flex items-center gap-3">
        {bars && (
          <div aria-hidden="true" className="flex gap-1">
            {Array.from({ length: ONBOARDING_STEPS }, (_, i) => i + 1).map((n) => (
              <div key={n} className={cn('h-1 w-6 rounded-full', n <= step ? 'bg-foreground' : 'bg-hairline')} />
            ))}
          </div>
        )}
        <span className="text-[13px] text-text-3">
          {t('onboarding.step', { step, total: ONBOARDING_STEPS })}
        </span>
      </div>
    </div>
  );
}
