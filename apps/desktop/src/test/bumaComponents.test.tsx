import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BumaBadge, BumaButton, BumaButtonGroup, BumaButtonLink, BumaChips } from '@/components/buma';
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
    const { BumaLoading } = await import('@/components/buma');
    render(<BumaLoading variant="process" labelText="Loading features" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading features');
    const anim = screen.getByTestId('loading');
    expect(anim.style.width).toBe('40px');
    expect(anim.style.getPropertyValue('--b-loader-fill')).toBe('var(--buma-icon-success)');
  });

  it('without a label it still names itself for screen readers', async () => {
    const { BumaLoading } = await import('@/components/buma');
    render(<BumaLoading variant="refresh" label={false} size={14} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByTestId('loadingLabel')).toBeNull();
    expect(screen.getByTestId('loading').style.width).toBe('14px');
  });
});
