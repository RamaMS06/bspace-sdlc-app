import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StepBar, currentStep } from '@/components/StepBar';
import { setUiLanguage } from '@/i18n';

/** Each step as "<name>:<done|active|todo>". */
const states = () =>
  screen.getAllByRole('listitem').map((li) => {
    const name = li.querySelector('[data-step-name]')!.textContent;
    const mark = li.querySelector('[data-step-mark]')!.textContent;
    const state = li.getAttribute('aria-current') === 'step' ? 'active' : mark === '✓' ? 'done' : 'todo';
    return `${name}:${state}`;
  });

describe('StepBar for a feature', () => {
  it('draft: Ideate is the step, nothing done yet', () => {
    render(<StepBar status="draft" />);
    expect(screen.getByRole('list', { name: 'SDLC progress' })).toBeInTheDocument();
    expect(states()).toEqual(['Ideate:active', 'Blueprint:todo', 'Design:todo', 'Build:todo', 'Verify:todo']);
  });

  it('building: Ideate, Blueprint and Design are done, Build is the step', () => {
    render(<StepBar status="building" />);
    expect(states()).toEqual(['Ideate:done', 'Blueprint:done', 'Design:done', 'Build:active', 'Verify:todo']);
  });

  it('verifying: Verify is the step, with a pulsing dot that holds still under reduced motion', () => {
    render(<StepBar status="building" rendering />);
    expect(states()).toEqual(['Ideate:done', 'Blueprint:done', 'Design:done', 'Build:done', 'Verify:active']);
    const step = screen.getByText('Verify').closest('li')!;
    const dot = step.querySelector('[data-step-pulse]')!;
    expect(dot).toHaveClass('motion-safe:animate-pulse');
    expect(dot.className).not.toMatch(/(^|\s)animate-pulse/);
    expect(within(step).getByText('Verifying now')).toHaveClass('sr-only');
    // Only the verify step pulses.
    expect(document.querySelectorAll('[data-step-pulse]')).toHaveLength(1);
  });

  it('finished: all five are done and none is the current step', () => {
    render(<StepBar status="rendered" />);
    expect(states()).toEqual(['Ideate:done', 'Blueprint:done', 'Design:done', 'Build:done', 'Verify:done']);
    expect(document.querySelector('[aria-current]')).toBeNull();
    expect(document.querySelector('[data-step-pulse]')).toBeNull();
  });

  it('a finished feature verifying again shows Verify as the step', () => {
    render(<StepBar status="rendered" rendering />);
    expect(states().at(-1)).toBe('Verify:active');
  });

  it('reads in Indonesian', () => {
    setUiLanguage('id');
    render(<StepBar status="building" rendering />);
    expect(screen.getByRole('list', { name: 'Progres SDLC' })).toBeInTheDocument();
    expect(states()).toEqual(['Ideasi:done', 'Blueprint:done', 'Desain:done', 'Build:done', 'Verifikasi:active']);
    expect(screen.getByText('Sedang verifikasi')).toHaveClass('sr-only');
  });

  it('currentStep: 5 means every step is done', () => {
    expect(currentStep('draft')).toBe(0);
    expect(currentStep('building')).toBe(3);
    expect(currentStep('draft', true)).toBe(4);
    expect(currentStep('rendered')).toBe(5);
    expect(currentStep('scheduled')).toBe(5);
  });
});

describe('StepBar with its own steps', () => {
  it('takes its own steps; without onPick they are plain text', () => {
    render(<StepBar steps={['Niche', 'Style', 'Schedule']} current={1} label="Feature steps" />);
    expect(screen.getByRole('list', { name: 'Feature steps' })).toBeInTheDocument();
    expect(screen.getByText('Style').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('with onPick every step is a button', async () => {
    const pick = vi.fn();
    render(<StepBar steps={['Niche', 'Style', 'Schedule']} current={0} label="Feature steps" onPick={pick} />);
    await userEvent.click(screen.getByRole('button', { name: /Schedule/ }));
    expect(pick).toHaveBeenCalledWith(2);
    expect(screen.getByRole('button', { name: /Niche/ })).toHaveAttribute('aria-current', 'step');
  });
});
