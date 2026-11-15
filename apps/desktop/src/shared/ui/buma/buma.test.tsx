import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BumaBadge, BumaButton, BumaButtonGroup, BumaButtonLink, BumaChips, BumaTabs } from '@/shared/ui/buma';
import '@/i18n';

describe('BUMA components (React ports of the Vue design system)', () => {
  it('Button: label by default, children win, click fires, condition picks the color', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<BumaButton label="Approve" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('button').className).toContain('--buma-background-success-500');
    rerender(<BumaButton condition="reject">Reject</BumaButton>);
    expect(screen.getByRole('button', { name: 'Reject' }).className).toContain('--buma-background-error-500');
  });

  it('Button: outline, small, block, pill and disabled', async () => {
    const onClick = vi.fn();
    render(<BumaButton label="X" outline small block pill disabled onClick={onClick} />);
    const b = screen.getByRole('button');
    expect(b).toBeDisabled();
    expect(b.className).toContain('bg-transparent');
    expect(b.className).toContain('h-6');
    expect(b.className).toContain('w-full');
    expect(b.className).toContain('rounded-[30px]');
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ButtonGroup: joins the buttons and skips items that are not clickable', async () => {
    const onClick = vi.fn();
    render(<BumaButtonGroup items={[{ label: 'Day' }, { label: 'Week', clickable: false }, { label: 'Month' }]} onClick={onClick} />);
    const [day, week, month] = screen.getAllByRole('button');
    expect(day!.className).toContain('rounded-r-none');
    expect(month!.className).toContain('rounded-l-none');
    await userEvent.click(week!);
    expect(onClick).not.toHaveBeenCalled();
    await userEvent.click(month!);
    expect(onClick).toHaveBeenCalledWith({ item: { label: 'Month' }, index: 2 });
  });

  it('ButtonLink: secondary takes a modifier', () => {
    render(<BumaButtonLink label="More" variant="secondary" modifier="dark" />);
    expect(screen.getByRole('button', { name: 'More' }).className).toContain('--buma-text-dark');
  });

  it('Badge: soft by default, filled with reverse', () => {
    const { rerender } = render(<BumaBadge label="Draft" variant="draft" />);
    expect(screen.getByTestId('badge').className).toContain('--buma-background-info-100');
    rerender(<BumaBadge label="Draft" variant="draft" reverse />);
    expect(screen.getByTestId('badge').className).toContain('--buma-background-info-500');
  });

  it('Chips: removable, and no clicks while disabled', async () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    const { rerender } = render(<BumaChips label="Flutter" removable onClick={onClick} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Flutter' }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
    rerender(<BumaChips label="Flutter" removable disabled onClick={onClick} onRemove={onRemove} />);
    expect(screen.queryByRole('button')).toBeNull();
    await userEvent.click(screen.getByTestId('chips'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('BUMA Loading', () => {
  it('shows the label as the status, and tints with the BUMA tokens', async () => {
    const { BumaLoading } = await import('@/shared/ui/buma');
    render(<BumaLoading variant="process" labelText="Loading features" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading features');
    const anim = screen.getByTestId('loading');
    expect(anim.style.width).toBe('40px');
    expect(anim.style.getPropertyValue('--b-loader-fill')).toBe('var(--buma-icon-success)');
  });

  it('without a label it still names itself for screen readers', async () => {
    const { BumaLoading } = await import('@/shared/ui/buma');
    render(<BumaLoading variant="refresh" label={false} size={14} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByTestId('loadingLabel')).toBeNull();
    expect(screen.getByTestId('loading').style.width).toBe('14px');
  });
});

describe('BumaTabs', () => {
  const items = [
    { value: 'a', label: 'Plugins' },
    { value: 'b', label: 'Skills', error: true },
    { value: 'c', label: 'Off', disabled: true },
  ];
  const Harness = ({ onChange = () => {} }: { onChange?(v: string): void }) => {
    const [v, setV] = React.useState('a');
    return <BumaTabs items={items} value={v} aria-label="Sections" onValueChange={(n) => (setV(n), onChange(n))} />;
  };

  it('is a tab list with one selected tab and its underline', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Plugins' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'false');
    // One underline, on the selected tab, 2px with rounded top corners.
    const bars = screen.getAllByTestId('buma-tab-indicator');
    expect(bars).toHaveLength(1);
    expect(bars[0]!.className).toContain('h-0.5');
    expect(bars[0]!.className).toContain('rounded-t-[4px]');
    expect(screen.getByRole('tab', { name: 'Plugins' }).contains(bars[0]!)).toBe(true);
  });

  it('switches on a click and by the arrow keys, and skips a disabled tab', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Skills' }));
    expect(onChange).toHaveBeenLastCalledWith('b');
    expect(screen.getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('a');
    await user.click(screen.getByRole('tab', { name: 'Off' }));
    expect(onChange).not.toHaveBeenCalledWith('c');
  });

  it('has no box or ring around a tab, selected or focused', async () => {
    render(<Harness />);
    await userEvent.setup().keyboard('{Tab}');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).not.toMatch(/ring-|outline-(?!none)|(^|\s)border(\s|$)/);
      expect(tab.className).toContain('border-0');
      expect(tab.className).toContain('outline-none');
    }
  });

  it('keeps a tab the same width in both weights, and an error tab turns danger when selected', async () => {
    render(<Harness />);
    const tab = screen.getByRole('tab', { name: 'Plugins' });
    // The semibold form is reserved under the label as a pseudo-element: the page's text has the label once.
    const label = tab.querySelector('[data-label]') as HTMLElement;
    expect(label).toHaveAttribute('data-label', 'Plugins');
    expect(label.className).toContain('after:font-semibold');
    expect(tab.textContent).toBe('Plugins');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Skills' }));
    expect(screen.getByRole('tab', { name: 'Skills' }).className).toContain('--buma-text-error-500');
    expect(screen.getByTestId('buma-tab-indicator').className).toContain('--buma-background-error-500');
  });
});
