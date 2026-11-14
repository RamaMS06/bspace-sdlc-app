import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLOSED_NOTE } from '@/shared/lib/agents';
import { en } from '@/i18n/en';

describe('closed-app note', () => {
  it('matches the note Rust writes on stale jobs', () => {
    // Startup moved out of lib.rs into app/setup.rs; look through every Rust source.
    const dir = resolve(__dirname, '../../../src-tauri/src');
    const rs = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith('.rs'));
    const rust = rs.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    expect(rust).toContain(`"${CLOSED_NOTE}"`);
  });
});

describe('auto-run note', () => {
  it('matches the line Rust writes for a command it approved itself', () => {
    // The ACP module moves as the Rust side is reorganised; look through every Rust source.
    const dir = resolve(__dirname, '../../../src-tauri/src');
    const rs = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith('.rs'));
    const rust = rs.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    expect(rust).toContain(`format!("${en.chat.ranWithoutAsking.replace('{{what}}', '{what}')}")`);
  });
});
