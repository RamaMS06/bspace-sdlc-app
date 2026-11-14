import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, PanelLeft } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';
import { isNarrow, useLayout } from '@/state/layout';

const isMac = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

function BarButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-text-2 transition-colors hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The window's top bar, like Claude Desktop's: the macOS window buttons, then hide/show the sidebar,
 * Back and Forward. The bar drags the window.
 */
export function TitleBar() {
  const { t } = useTranslation();
  const canBack = useApp((s) => s.past.length > 0);
  const canForward = useApp((s) => s.future.length > 0);
  const narrow = useLayout((s) => isNarrow(s.windowWidth));
  // In a narrow window the button opens the sidebar drawer instead.
  const hidden = useLayout((s) => (narrow ? !s.drawerOpen : s.sidebarHidden));
  const toggle = () => {
    const l = useLayout.getState();
    if (narrow) l.setDrawerOpen(!l.drawerOpen);
    else l.toggleSidebarHidden();
  };
  return (
    <TooltipProvider delayDuration={400}>
      <div
        data-tauri-drag-region
        role="toolbar"
        aria-label={t('titleBar.aria')}
        className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border bg-sidebar pr-3', isMac() ? 'pl-[84px]' : 'pl-3')}
      >
        <BarButton label={hidden ? t('titleBar.showSidebar') : t('titleBar.hideSidebar')} onClick={toggle}>
          <PanelLeft size={16} strokeWidth={1.5} aria-hidden="true" />
        </BarButton>
        <BarButton label={t('titleBar.back')} disabled={!canBack} onClick={() => useApp.getState().back()}>
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />
        </BarButton>
        <BarButton label={t('titleBar.forward')} disabled={!canForward} onClick={() => useApp.getState().forward()}>
          <ArrowRight size={16} strokeWidth={1.5} aria-hidden="true" />
        </BarButton>
      </div>
    </TooltipProvider>
  );
}
