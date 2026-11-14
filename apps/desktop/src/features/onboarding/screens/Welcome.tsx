import { useTranslation } from 'react-i18next';
import { ArrowRight, Bot, GitBranch, ShieldCheck } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { OnboardingHeader } from '@/features/onboarding/components/OnboardingHeader';
import { SdlcWorkflow } from '@/features/sdlc';
import { LANGUAGES, uiLanguage } from '@/i18n';
import { chooseLanguage } from '@/shared/lib/language';
import { cn } from '@/shared/lib/utils';
import { useApp } from '@/shared/state/app';

const POINTS = [
  { icon: GitBranch, key: 'noPrompts' },
  { icon: Bot, key: 'ownAgent' },
  { icon: ShieldCheck, key: 'checked' },
] as const;

export function Welcome() {
  const navigate = useApp((s) => s.navigate);
  const { t } = useTranslation();
  const lang = uiLanguage();
  return (
    // The welcome screen is always light: white, with the BUMA and BSpace logos, whatever the app theme.
    <div className="relative flex min-h-full flex-wrap overflow-hidden bg-background text-foreground">
      <div role="group" aria-label={t('common.language')} className="absolute top-6 right-8 z-10 flex gap-1 rounded-md border border-hairline bg-background p-0.5">
        {LANGUAGES.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={lang === l}
            onClick={() => void chooseLanguage(l)}
            className={cn(
              'h-7 rounded-sm px-2 font-mono text-xs font-medium',
              lang === l ? 'bg-raised text-foreground' : 'text-text-3 hover:text-foreground',
            )}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="relative flex min-w-0 flex-[1_1_540px] flex-col gap-10 px-16 pt-10 pb-12">
        <OnboardingHeader step={1} />
        <div data-tauri-drag-region className="mt-10 flex flex-col gap-5">
          <span className="font-mono text-[13px] font-medium tracking-[0.12em] text-primary">
            {t('onboarding.welcome.eyebrow')}
          </span>
          <h1 className="text-[56px] leading-[1.04] font-extrabold tracking-[-0.035em]">
            {t('onboarding.welcome.headline1')}
            <br />
            {t('onboarding.welcome.headline2')}
          </h1>
          <p className="max-w-[480px] text-[18px] leading-[1.6] text-text-2">
            {t('onboarding.welcome.lead')}
          </p>
        </div>
        <ul className="flex max-w-[500px] flex-col gap-4">
          {POINTS.map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-start gap-3">
              <Icon size={18} strokeWidth={1.5} aria-hidden="true" className="mt-0.5 shrink-0 text-text-2" />
              <div className="flex flex-col gap-1">
                <span className="text-[15px] font-medium">{t(`onboarding.welcome.${key}Title`)}</span>
                <span className="text-sm leading-normal text-text-2">{t(`onboarding.welcome.${key}Text`)}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex flex-wrap items-center gap-6">
          <Button className="h-12 gap-2 px-5 text-base" onClick={() => navigate({ name: 'connect' })}>
            {t('onboarding.welcome.getStarted')}
            <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div
        data-tauri-drag-region
        className="relative flex min-w-0 flex-[1_1_460px] items-center justify-center px-6 py-12"
      >
        <SdlcWorkflow />
      </div>
    </div>
  );
}
