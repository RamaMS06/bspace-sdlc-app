import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { Project } from '@bspace-sdlc-app/shared';
import { Button } from '@/shared/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Input } from '@/shared/ui/primitives/input';
import { Select } from '@/shared/ui/primitives/select';
import {
  shareInvite,
  shareProjects,
  shareRevoke,
  shareStatus,
  type AzProject,
  type InviteResult,
  type ShareInfo,
  type ShareRole,
} from '@/features/workflow/lib/share';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/**
 * Invite people to one feature. The feature's folder (and so its workflow progress) is shared as its own
 * Azure DevOps repo; a viewer can read it, a contributor can also push. Azure DevOps enforces the access.
 */
export function InviteDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [projects, setProjects] = useState<AzProject[] | null>(null);
  const [azureProject, setAzureProject] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ShareRole>('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(null);
    setResult(null);
    shareStatus(project.id)
      .then((i) => {
        if (!alive) return;
        setInfo(i);
        if (i) return;
        return shareProjects().then((list) => {
          if (!alive) return;
          setProjects(list);
          setAzureProject((c) => c || (list.length === 1 ? list[0]!.id : ''));
        });
      })
      .catch((e) => alive && setError(message(e)));
    return () => {
      alive = false;
    };
  }, [open, project.id]);

  const needsProject = !info;
  const chosen = projects?.find((p) => p.id === azureProject) ?? null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !email.trim() || (needsProject && !chosen)) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await shareInvite(project.id, needsProject ? chosen : null, email.trim(), role);
      setInfo(r.info);
      setResult(r);
      setEmail('');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (who: string) => {
    setBusy(true);
    setError(null);
    try {
      setInfo(await shareRevoke(project.id, who));
      setResult(null);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('invite.title', { title: project.title })}</DialogTitle>
            <DialogDescription>{t('invite.body')}</DialogDescription>
          </DialogHeader>

          {needsProject && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">{t('invite.project')}</span>
              <Select aria-label={t('invite.project')} value={azureProject} onChange={(e) => setAzureProject(e.target.value)} disabled={!projects}>
                <option value="">{projects ? t('invite.pickProject') : t('invite.loadingProjects')}</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <span className="text-xs text-text-3">{t('invite.projectHint')}</span>
            </label>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[13px] font-medium">{t('invite.email')}</span>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('invite.emailPlaceholder')} type="email" autoFocus />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">{t('invite.role')}</span>
              <Select aria-label={t('invite.role')} className="w-40" value={role} onChange={(e) => setRole(e.target.value as ShareRole)}>
                <option value="viewer">{t('invite.viewer')}</option>
                <option value="contributor">{t('invite.contributor')}</option>
              </Select>
            </label>
          </div>
          <p className="m-0 text-xs text-text-3">{t(role === 'viewer' ? 'invite.viewerHint' : 'invite.contributorHint')}</p>

          {error && (
            <p role="alert" className="m-0 text-[13px] text-error">
              {error}
            </p>
          )}
          {result && (
            <div role="status" className="flex flex-col gap-1 rounded-md border border-border bg-raised px-3 py-2 text-[13px]">
              <span>{t(result.addedToOrg ? 'invite.doneAdded' : 'invite.done', { email: result.info.invites.at(-1)?.email ?? '' })}</span>
              {result.orgNote && <span className="text-text-3">{t('invite.orgNote', { note: result.orgNote })}</span>}
            </div>
          )}

          {info && (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-medium">{t('invite.invited')}</span>
              {info.webUrl && (
                <span className="truncate font-mono text-xs text-text-3" title={info.webUrl}>
                  {info.webUrl}
                </span>
              )}
              {info.invites.length === 0 ? (
                <span className="text-xs text-text-3">{t('invite.none')}</span>
              ) : (
                <ul aria-label={t('invite.invited')} className="m-0 flex list-none flex-col gap-1 p-0">
                  {info.invites.map((i) => (
                    <li key={i.email} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[13px]">
                      <span className="min-w-0 flex-1 truncate">{i.email}</span>
                      <span className="text-text-3">{t(i.role === 'viewer' ? 'invite.viewer' : 'invite.contributor')}</span>
                      <button
                        type="button"
                        aria-label={t('invite.remove', { email: i.email })}
                        disabled={busy}
                        onClick={() => void remove(i.email)}
                        className="flex size-6 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-text-3 hover:text-text-1"
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
              {t('common.close')}
            </Button>
            <Button type="submit" disabled={busy || !email.trim() || (needsProject && !chosen)}>
              {busy ? t('invite.inviting') : t('invite.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
