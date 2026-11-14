import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, ExternalLink } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Button } from '@/components/Button';
import { OnboardingHeader } from '@/components/OnboardingHeader';
import { Input } from '@/components/ui/input';
import { updateSettings } from '@/lib/ipc';
import { DEFAULT_DEVOPS_ORG, tokensUrl } from '@/lib/devops';
import { useApp } from '@/state/app';
import { useDevops } from '@/state/devops';
import { track } from '@/lib/analytics';

/** Microsoft's four-square mark, in its own colors (a brand mark, not app colors). */
function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" width={16} height={16} aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

/** Two letters for the avatar: the first of the first and last name. */
function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '?';
}

/**
 * The last onboarding step, required: sign in to Azure DevOps, where BUMA keeps its projects, the BUMA
 * Design System packages and buma-registry. Sign in with Microsoft (one click, through the Azure CLI), or
 * with a personal access token. There is no skip; the app doesn't open without it.
 */
export function AccountStep() {
  const { t } = useTranslation();
  const navigate = useApp((s) => s.navigate);
  const setSettings = useApp((s) => s.setSettings);
  const status = useDevops((s) => s.status);
  const busy = useDevops((s) => s.busy);
  const signInError = useDevops((s) => s.error);
  const signIn = useDevops((s) => s.signIn);
  const signInMicrosoft = useDevops((s) => s.signInMicrosoft);
  const signOut = useDevops((s) => s.signOut);
  const [org, setOrg] = useState(DEFAULT_DEVOPS_ORG);
  const [pat, setPat] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void useDevops.getState().init().catch(() => {});
  }, []);

  const profile = status?.signedIn ? status.profile : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!!busy || !org.trim() || !pat.trim()) return;
    // The token goes to Rust once and is never kept in the page.
    if (await signIn(org, pat)) setPat('');
  };

  const finish = async () => {
    if (!profile) return;
    setFinishing(true);
    setError(null);
    try {
      setSettings(await updateSettings({ onboarded: true }));
      track('onboarding completed', { signed_in: true });
      navigate({ name: 'chat-new' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFinishing(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center bg-background px-6 pt-10 pb-12 text-foreground">
      <div className="flex w-full max-w-[720px] flex-col gap-8">
        <OnboardingHeader step={4} bars />
        <div data-tauri-drag-region className="mt-4 flex flex-col gap-2">
          <h1 className="text-4xl font-semibold tracking-[-0.02em]">{t('onboarding.account.title')}</h1>
          <p className="text-base leading-[1.6] text-text-2">{t('onboarding.account.intro')}</p>
        </div>

        {profile ? (
          <div role="status" className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
            <div aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-raised text-sm font-semibold">
              {initialsOf(profile.displayName)}
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{profile.displayName}</span>
              <span className="truncate text-xs text-text-3">
                {/* i18n-ignore: a URL */}
                {profile.email ? `${profile.email} · ` : ''}dev.azure.com/{profile.org}
              </span>
            </div>
            <span className="ml-auto inline-flex items-center gap-1 text-[13px] text-success">
              <Check size={16} aria-hidden="true" />
              {t('onboarding.account.signedIn')}
            </span>
            <Button variant="secondary" small onClick={() => void signOut()}>
              {t('onboarding.account.signOut')}
            </Button>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">{t('onboarding.account.org')}</span>
              <div className="flex items-center gap-2">
                {/* i18n-ignore: a URL */}
                <span className="text-sm text-text-3">dev.azure.com/</span>
                <Input
                  value={org}
                  onChange={(e) => setOrg(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={t('onboarding.account.org')}
                  className="max-w-[280px]"
                />
              </div>
            </label>
            <Button
              type="button"
              block
              className="gap-2"
              disabled={!!busy || !org.trim()}
              onClick={() => void signInMicrosoft(org)}
            >
              <MicrosoftLogo />
              {busy === 'microsoft' ? t('onboarding.account.microsoftBusy') : t('onboarding.account.microsoft')}
            </Button>
            <span className="text-xs leading-normal text-text-3">{t('onboarding.account.microsoftHint')}</span>
            <div className="flex items-center gap-3 text-xs text-text-3">
              <span className="h-px flex-1 bg-border" />
              {t('onboarding.account.orPat')}
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between">
                <label htmlFor="devops-pat" className="text-[13px] font-medium">
                  {t('onboarding.account.pat')}
                </label>
                <Button type="button" variant="secondary" small onClick={() => void openUrl(tokensUrl(org.trim())).catch(() => {})}>
                  {t('onboarding.account.createToken')}
                  <ExternalLink size={12} aria-hidden="true" />
                </Button>
              </span>
              <Input
                id="devops-pat"
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <span className="text-xs leading-normal text-text-3">{t('onboarding.account.patHint')}</span>
            </div>
            {signInError && (
              <p role="alert" className="m-0 text-[13px] text-error">
                {signInError}
              </p>
            )}
            <Button type="submit" variant="secondary" className="self-start" disabled={!!busy || !org.trim() || !pat.trim()}>
              {busy === 'pat' ? t('onboarding.account.checking') : t('onboarding.account.signIn')}
            </Button>
          </form>
        )}

        {error && (
          <p role="alert" className="m-0 text-[13px] text-error">
            {error}
          </p>
        )}

        <div className="mt-2 flex items-center gap-4">
          <Button variant="secondary" className="mr-auto" onClick={() => navigate({ name: 'requirements' })}>
            {t('common.back')}
          </Button>
          {!profile && <span className="text-[13px] text-text-3">{t('onboarding.account.required')}</span>}
          <Button className="gap-2" disabled={!profile || finishing} onClick={() => void finish()}>
            {t('onboarding.account.start')}
            <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
