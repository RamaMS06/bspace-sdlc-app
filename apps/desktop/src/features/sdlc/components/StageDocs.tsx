import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ExternalLink, FileText, Image as ImageIcon, X } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { SDLC_STAGES } from '@/features/sdlc/components/SdlcWorkflow';
import { DevicePanel } from '@/features/sdlc/components/DevicePanel';
import { stageDocs, type StageDoc, type StageDocs as Docs } from '@/features/sdlc/lib/stageDocs';
import { assetUrl, readProjectDocx, readProjectFile } from '@/shared/lib/ipc';
import { BumaLoading } from '@/shared/ui/buma/Loading';
import { Button } from '@/shared/ui/Button';
import { Markdown } from '@/shared/ui/Markdown';
import { MaterialIcon } from '@/shared/ui/MaterialIcon';
import { cn } from '@/shared/lib/utils';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One document: Markdown read as Markdown, a .docx converted, YAML and other text as a code block, pictures as a grid. */
function DocView({ projectId, doc }: { projectId: string; doc: StageDoc }) {
  const { t } = useTranslation();
  const [text, setText] = useState<string | null>(null);
  const [images, setImages] = useState<{ path: string; src: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setText(null);
    setImages([]);
    setError(null);
    const load = async () => {
      if (doc.kind === 'device') return;
      if (doc.kind === 'images') {
        const list = await Promise.all(doc.paths.map(async (p) => ({ path: p, src: assetUrl((await readProjectFile(projectId, p)).absPath) })));
        if (alive) setImages(list);
        return;
      }
      if (doc.kind === 'docx') {
        const md = await readProjectDocx(projectId, doc.path);
        if (alive) setText(md);
        return;
      }
      const f = await readProjectFile(projectId, doc.path);
      if (f.kind !== 'text' || f.text === null) throw new Error(t('docs.cantShow'));
      const ext = doc.name.split('.').pop() ?? '';
      // i18n-ignore: a Markdown code fence around the file's text.
      if (alive) setText(doc.kind === 'markdown' ? f.text : `\`\`\`${ext}\n${f.text}\n\`\`\``);
    };
    load().catch((e) => alive && setError(message(e)));
    return () => {
      alive = false;
    };
  }, [projectId, doc, t]);

  if (error)
    return (
      <p role="alert" className="m-0 text-[13px] text-error">
        {error}
      </p>
    );
  if (doc.kind === 'device') return <DevicePanel projectId={projectId} />;
  if (doc.kind === 'images') {
    if (!images.length) return <BumaLoading variant="process" labelText={t('docs.loading')} />;
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {images.map((im) => (
          <figure key={im.path} className="m-0 flex flex-col gap-1">
            <img src={im.src} alt={im.path.split('/').pop()} className="w-full rounded-md border border-border bg-raised object-contain" />
            <figcaption className="truncate text-[11px] text-text-3">{im.path.split('/').pop()}</figcaption>
          </figure>
        ))}
      </div>
    );
  }
  if (text === null) return <BumaLoading variant="process" labelText={t('docs.loading')} />;
  if (!text.trim()) return <p className="m-0 text-[13px] text-text-3">{t('docs.emptyFile')}</p>;
  return <Markdown text={text} />;
}

/**
 * The documents a stage made (Blueprint and FTSD, wireframe, design and its screenshots…), read in the
 * app: pick one at the top, read it below. A Figma link opens the design in Figma.
 */
export function StageDocs({ projectId, stage, onClose, back = false }: { projectId: string; stage: number; onClose(): void; back?: boolean }) {
  const { t } = useTranslation();
  const [docs, setDocs] = useState<Docs | null>(null);
  const [open, setOpen] = useState(0);
  const name = SDLC_STAGES[stage]?.name.toLowerCase() ?? 'ideate';
  const label = t(`pipeline.stages.${name}` as 'pipeline.stages.ideate');

  useEffect(() => {
    let alive = true;
    setDocs(null);
    setOpen(0);
    void stageDocs(projectId, stage)
      .then((d) => alive && setDocs(d))
      .catch(() => alive && setDocs({ docs: [], figma: null }));
    return () => {
      alive = false;
    };
  }, [projectId, stage]);

  const current = docs?.docs[open];
  return (
    <section aria-label={t('docs.aria', { stage: label })} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        {back && (
          <button
            type="button"
            aria-label={t('docs.back')}
            onClick={onClose}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-text-2 hover:bg-raised"
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
        )}
        <span className="mr-auto truncate text-sm font-semibold">{t('docs.title', { stage: label })}</span>
        {docs?.figma && (
          <Button small variant="secondary" className="gap-1.5" onClick={() => void openUrl(docs.figma!).catch(() => {})}>
            <ExternalLink size={13} aria-hidden="true" />
            {t('docs.openFigma')}
          </Button>
        )}
        {!back && (
          <button
            type="button"
            aria-label={t('docs.close')}
            onClick={onClose}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-text-2 hover:bg-raised"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </header>
      {docs === null ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <BumaLoading variant="process" labelText={t('docs.loading')} />
        </div>
      ) : docs.docs.length === 0 ? (
        <p className="m-0 p-6 text-[13px] text-text-3">{t('docs.none')}</p>
      ) : (
        <>
          <div role="tablist" aria-label={t('docs.listAria')} className="flex shrink-0 flex-wrap gap-1.5 border-b border-border px-4 py-2">
            {docs.docs.map((d, i) => (
              <button
                key={d.path}
                type="button"
                role="tab"
                aria-selected={i === open}
                onClick={() => setOpen(i)}
                className={cn(
                  'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[12px]',
                  i === open ? 'border-primary-border bg-primary-soft text-primary-text' : 'border-border bg-transparent text-text-2 hover:bg-raised',
                )}
              >
                {d.kind === 'images' ? <ImageIcon size={13} aria-hidden="true" /> : d.kind === 'device' ? <MaterialIcon name="preview" size={14} /> : <FileText size={13} aria-hidden="true" />}
                {d.kind === 'images' ? t('docs.pictures', { name: d.name, count: d.paths.length }) : d.kind === 'device' ? t('docs.device') : d.name}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-4">
            {current && <DocView key={current.path} projectId={projectId} doc={current} />}
          </div>
        </>
      )}
    </section>
  );
}
