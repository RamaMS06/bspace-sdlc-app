import { describe, expect, it } from 'vitest';
import { sdlcStart } from '@/features/sdlc/lib/featureFlow';

describe('what starts a workflow', () => {
  it('only /using-bspace-sdlc does, and the words after it name the feature', () => {
    expect(sdlcStart('/using-bspace-sdlc')).toBe('');
    expect(sdlcStart('/using-bspace-sdlc Attendance for HR')).toBe('Attendance for HR');
    expect(sdlcStart('  /using-bspace-sdlc   Payroll  ')).toBe('Payroll');
  });

  it('no other message does: plain chat, a question, or any other skill', () => {
    for (const text of [
      'hello',
      'what is a gate in the SDLC?',
      'start a new workflow for attendance',
      'using-bspace-sdlc',
      'please run /using-bspace-sdlc',
      '/blueprint-ftsd Attendance',
      '/flutter-slice-screen',
      '/stakeholder-intake notes.md',
      '/not-a-skill',
    ]) {
      expect(sdlcStart(text), text).toBeNull();
    }
  });
});
