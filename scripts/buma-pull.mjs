// Pulls BUMA Design System Vue components with buma-cli into design-system/vue-source/ as the reference
// for their React ports in apps/desktop/src/shared/ui/buma/. The desktop app is React, so the Vue files
// are never imported: they are the spec (props, variants, styles) a port must match.
//
//   pnpm buma:pull button badge chips
//
// Environment:
//   BUMA_CLI       path to buma-cli's dist/cli.js (default: ../buma-cli/dist/cli.js, else `npx @buma-dev/cli`)
//   BUMA_REGISTRY  registry: a local buma-registry/dist folder or the Azure DevOps repo URL
//                  (default: ../buma-registry/dist when it exists, else buma-cli's own default)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'design-system/vue-source');
const LOCK = join(root, 'design-system/buma-components.json');

const components = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!components.length) {
  console.error('Usage: pnpm buma:pull <component...>   e.g. pnpm buma:pull button badge');
  process.exit(1);
}

const siblingCli = resolve(root, '../buma-cli/dist/cli.js');
const cli = process.env.BUMA_CLI ?? (existsSync(siblingCli) ? siblingCli : null);
const siblingRegistry = resolve(root, '../buma-registry/dist');
const registry = process.env.BUMA_REGISTRY ?? (existsSync(siblingRegistry) ? siblingRegistry : undefined);

const config = {
  framework: 'vue',
  ...(registry ? { registry } : {}),
  tokens: '@buma-dev/styles',
  aliases: { components: '@/components', ui: '@/components/ui', lib: '@/lib', utils: '@/lib/utils' },
};
writeFileSync(join(OUT, 'buma.config.json'), JSON.stringify(config, null, 2) + '\n');

const [cmd, args] = cli
  ? [process.execPath, [cli, 'add', ...components, '--overwrite', '--cwd', OUT]]
  : ['npx', ['-y', '@buma-dev/cli', 'add', ...components, '--overwrite', '--cwd', OUT]];
const run = spawnSync(cmd, args, { stdio: 'inherit', cwd: OUT });
if (run.status !== 0) process.exit(run.status ?? 1);

// Remember what was pulled and from where, so a port can be checked against its source later.
const lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : { components: {} };
const today = new Date().toISOString().slice(0, 10);
for (const name of components) {
  lock.components[name] = { ...(lock.components[name] ?? {}), pulled: today, registry: registry ? 'local' : 'azure' };
}
writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
console.log(`\nPulled ${components.join(', ')} into design-system/vue-source/. Port them in apps/desktop/src/shared/ui/buma/.`);
