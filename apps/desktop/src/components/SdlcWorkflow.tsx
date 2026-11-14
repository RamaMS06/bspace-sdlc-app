import { useEffect, useState } from 'react';
import { Check, CodeXml, FileText, LayoutTemplate, Lightbulb, PenTool, Rocket, ShieldCheck, type LucideIcon } from 'lucide-react';
import { siFigma, siFlutter, siVuedotjs, type SimpleIcon } from 'simple-icons';
import { prefersReducedMotion } from '@/lib/confetti';
import { cn } from '@/lib/utils';

/** The SDLC stages a feature moves through, ideate to deploy, with the skill or gate behind each. */
export const SDLC_STAGES: { icon: LucideIcon; name: string; detail: string; gate: string; skill: string; ask: string }[] = [
  {
    icon: Lightbulb,
    name: 'Ideate',
    detail: 'Intake · brainstorm · intent.md',
    gate: 'G1',
    skill: 'stakeholder-intake',
    ask: 'Run the stakeholder-intake skill for this feature, then brainstorm with the using-bspace-sdlc skill toward an intent.md I can approve.',
  },
  {
    icon: FileText,
    name: 'Blueprint',
    detail: 'FSD · FTSD · API contract',
    gate: 'B · F1',
    skill: 'blueprint-ftsd',
    ask: 'Run the blueprint-ftsd skill for this feature: the next Blueprint, FTSD or API contract step.',
  },
  { icon: LayoutTemplate, name: 'Wireframe', detail: 'Lo-fi screens and flows', gate: 'WF', skill: 'wireframe-lofi', ask: 'Run the wireframe-lofi skill for this feature.' },
  {
    icon: PenTool,
    name: 'Design',
    detail: 'Figma · BUMA Design System',
    gate: 'G2',
    skill: 'figma-generate-screen',
    ask: 'Run the figma-generate-screen skill for this feature: design its screens in Figma with the BUMA Design System.',
  },
  {
    icon: CodeXml,
    name: 'Build',
    detail: 'Flutter · Vue slice',
    gate: 'G4',
    skill: 'flutter-slice-screen',
    ask: 'Slice the approved designs of this feature: flutter-slice-screen for Flutter, vue-slice-screen for Vue (the intent says which platforms).',
  },
  {
    icon: ShieldCheck,
    name: 'Verify',
    detail: 'Run-verify · fidelity check',
    gate: 'QA',
    skill: 'flutter-run-verify',
    ask: 'Verify this feature: flutter-run-verify, then flutter-verify-fidelity against the Figma design.',
  },
  {
    icon: Rocket,
    name: 'Deploy',
    detail: 'Close and release',
    gate: 'Close',
    skill: 'using-bspace-sdlc',
    ask: 'Close this feature with the using-bspace-sdlc skill: write close.md and tell me what is left to release.',
  },
];

const STEP_MS = 1600;
/** Where the still picture stops when motion is reduced: building, with the earlier stages done. */
const STILL_AT = 4;

/** A brand mark from simple-icons (CC0) in its own color, on a white tile that floats. */
function FloatingMark({ icon, className, delay, size = 56 }: { icon: SimpleIcon; className: string; delay: string; size?: number }) {
  return (
    <div
      className={cn(
        'buma-float absolute z-20 flex items-center justify-center rounded-2xl border border-border bg-card shadow-[0_12px_32px_-12px_var(--buma-shadow-25)]',
        className,
      )}
      style={{ width: size, height: size, animationDelay: delay }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill={`#${icon.hex}`} aria-label={icon.title} role="img">
        <path d={icon.path} />
      </svg>
    </div>
  );
}

/**
 * The welcome screen's picture: a feature's pipeline card, ideate to deploy, with the active stage moving
 * down the list on a loop, and the Flutter, Vue and Figma marks floating around it. Decoration only.
 */
export function SdlcWorkflow() {
  const reduced = prefersReducedMotion();
  // One tick past the last stage shows everything done before the loop starts over.
  const [active, setActive] = useState(reduced ? STILL_AT : 0);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setActive((a) => (a + 1) % (SDLC_STAGES.length + 1)), STEP_MS);
    return () => clearInterval(id);
  }, [reduced]);

  const done = Math.min(active, SDLC_STAGES.length);
  const percent = Math.round((done / SDLC_STAGES.length) * 100);

  return (
    <div className="relative h-[540px] w-[472px] max-w-full" aria-hidden="true" data-testid="sdlc-workflow">

      <div className="absolute top-12 left-8 w-[372px] rounded-2xl border border-border bg-card p-5 shadow-[0_24px_48px_-24px_var(--buma-shadow-25)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            {/* i18n-ignore: a made-up sample feature, the same in both languages */}
            <span className="font-mono text-[11px] font-medium tracking-[0.08em] text-text-2">ATT-01 · FEATURE</span>
            {/* i18n-ignore: sample feature name */}
            <span className="text-[17px] font-extrabold tracking-[-0.02em]">Attendance</span>
          </div>
          <span className="rounded-full bg-primary-soft px-2.5 py-1 font-mono text-[11px] font-medium text-primary-text tabular-nums">
            {percent}%
          </span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }} />
        </div>

        <ol className="relative mt-4 flex flex-col">
          {/* The rail behind the stage icons. */}
          <span className="absolute top-4 bottom-4 left-[15px] w-px bg-border" />
          {SDLC_STAGES.map(({ icon: Icon, name, detail, gate }, i) => {
            const state = i < active ? 'done' : i === active ? 'active' : 'todo';
            return (
              <li key={name} className="relative flex items-center gap-3 py-[7px]">
                <span
                  className={cn(
                    'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors duration-300',
                    state === 'done' && 'border-transparent bg-primary text-primary-foreground',
                    state === 'active' && 'border-primary bg-card text-primary-text',
                    state === 'todo' && 'border-border bg-card text-text-3',
                  )}
                >
                  {state === 'done' ? <Check size={15} strokeWidth={2.5} /> : <Icon size={15} strokeWidth={1.75} />}
                  {state === 'active' && <span className="absolute inset-[-4px] rounded-full border-2 border-primary-border buma-pulse" />}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className={cn('text-[13px] font-semibold', state === 'todo' ? 'text-text-2' : 'text-foreground')}>{name}</span>
                  <span className="truncate text-[11px] text-text-2">{detail}</span>
                  {state === 'active' && (
                    <span className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-raised">
                      <span className="buma-indeterminate block h-full rounded-full bg-primary" />
                    </span>
                  )}
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium',
                    state === 'done' && 'bg-success-soft text-success',
                    state === 'active' && 'bg-primary text-primary-foreground',
                    state === 'todo' && 'bg-raised text-text-2',
                  )}
                >
                  {gate}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Drawn after the card so they float over its edges. */}
      <FloatingMark icon={siFlutter} className="top-2 right-2" delay="0s" size={64} />
      <FloatingMark icon={siVuedotjs} className="bottom-3 left-0" delay="-1.6s" size={60} />
      <FloatingMark icon={siFigma} className="top-[210px] -right-1" delay="-0.8s" size={44} />
    </div>
  );
}
