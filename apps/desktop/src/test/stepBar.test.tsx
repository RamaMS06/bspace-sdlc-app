import { render, screen } from '@testing-library/react';
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

  it('reads in Indonesian', () => {
    setUiLanguage('id');
    render(<StepBar status="building" />);
    expect(screen.getByRole('list', { name: 'Progres SDLC' })).toBeInTheDocument();
    expect(states()).toEqual(['Ideasi:done', 'Blueprint:done', 'Desain:done', 'Build:active', 'Verifikasi:todo']);
  });

  it('currentStep: draft is Ideate, building is Build, verifying is Verify', () => {
    expect(currentStep('draft')).toBe(0);
    expect(currentStep('building')).toBe(3);
    expect(currentStep('draft', true)).toBe(4);
  });
});

describe('StepBar with its own steps', () => {
  it('takes its own steps; without onPick they are plain text', () => {
    render(<StepBar steps={['Intake', 'Blueprint', 'Design']} current={1} label="Feature steps" />);
    expect(screen.getByRole('list', { name: 'Feature steps' })).toBeInTheDocument();
    expect(screen.getByText('Blueprint').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('with onPick every step is a button', async () => {
    const pick = vi.fn();
    render(<StepBar steps={['Intake', 'Blueprint', 'Design']} current={0} label="Feature steps" onPick={pick} />);
    await userEvent.click(screen.getByRole('button', { name: /Design/ }));
    expect(pick).toHaveBeenCalledWith(2);
    expect(screen.getByRole('button', { name: /Intake/ })).toHaveAttribute('aria-current', 'step');
  });
});
