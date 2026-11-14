# apps/desktop/src

Feature-based layout. `@/` is `src/`.

```
app/        entry (main.tsx), App.tsx (boot + route switch), layout/ (Sidebar, TitleBar, StatusBar, ...)
features/   one folder per product area: agents chat devops onboarding sdlc settings skills tools updater usage workflow
  <name>/   screens/ components/ state/ lib/ (only the ones it needs) + index.ts (its public API)
shared/     ui/ (Button, Markdown, ... + primitives/ = shadcn, buma/ = BUMA design system), lib/ (ipc, utils, time, ...),
            state/ (app.ts = route + settings store, layout.ts = panel sizes)
i18n/ styles/ assets/   unchanged
test/setup.ts           vitest setup only; tests live next to their code
```

## Import rules

- Across features: only through the barrel, `import { useChat } from '@/features/chat'`. Never `@/features/chat/state/chat`
  from outside `features/chat`.
- Inside a feature: deep `@/features/<self>/...` paths. Never import your own barrel (it makes cycles).
- `shared/` imports only `shared/`, `i18n/`, `assets/` and packages. Never `features/` or `app/`.
- `app/` may import any barrel and `shared/`. Features never import `app/`.
- Feature dependencies form a DAG (left may import right only):
  `workflow, updater, settings, onboarding -> chat -> agents -> usage`; `chat -> sdlc, skills`;
  `settings, onboarding -> devops, tools`. If two features need the same thing, move it to `shared/` or the lower feature.
- The route store (`shared/state/app.ts`) is in `shared` so any feature can navigate without importing `app/`.
- New export used by another feature: add it to that feature's `index.ts` (named re-exports, no `export *`).

## Naming

- Components: `PascalCase.tsx` named after the exported component. Other modules: `camelCase.ts`. Folders: lowercase.
- `shared/ui/primitives/*` are shadcn files (kebab-case); `components.json` points the shadcn CLI there.

## Tests

- Colocated: `Foo.test.tsx` next to `Foo.tsx`; tests that span several modules use a camelCase topic name
  (`modelPicker.test.tsx`) in the folder of their main subject; whole-app tests live in `app/`.
- Tests import and `vi.mock` the defining module by its deep path (`vi.mock('@/features/chat/state/chat')`), never a
  barrel: a mock on a barrel does not reach code that imports the module directly. After moving a file, grep its
  old path in `vi.mock(` calls: a stale path silently stops mocking.
- `i18n/i18nGuard.test.ts` scans `app/`, `features/`, `shared/` (not tests, not shadcn primitives) for untranslated copy.
