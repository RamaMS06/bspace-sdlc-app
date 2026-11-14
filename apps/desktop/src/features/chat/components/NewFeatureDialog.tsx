import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Input } from '@/shared/ui/primitives/input';
import { runStage } from '@/features/chat/lib/featureChat';
import { createFeature } from '@/features/sdlc';
import { useApp } from '@/shared/state/app';

/**
 * Starts a feature: its name makes the project (folder and brief), then the agent starts on Ideate
 * (stakeholder intake, then brainstorm) in the feature's chat.
 */
export function NewFeatureDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const title = name.trim();
    if (!title || !settings || busy) return;
    setBusy(true);
    setError(null);
    try {
      const project = await createFeature(title);
      onOpenChange(false);
      setName('');
      await runStage(project, 0, settings.defaultAgent, t('workflow.startAsk', { title }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('workflow.newTitle')}</DialogTitle>
            <DialogDescription>{t('workflow.newBody')}</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">{t('workflow.name')}</span>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('workflow.namePlaceholder')} maxLength={120} />
          </label>
          {error && (
            <p role="alert" className="m-0 text-[13px] text-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? t('workflow.creating') : t('workflow.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
