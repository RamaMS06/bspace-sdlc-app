# Package harness

Package installs plus bootstrap wiring, recorded as `harness:` lines in `plan.md` `## Notes`.
Install/wire deterministically from the one-pass screening result; never touch an unrelated app-root
file; never ask for approval.

## Contents

0. Flutter SDK — pinned to the DS
1. Phases
2. Reuse a prior record — verified
3. Detect
4. Collect pending writes
5. Apply
6. Compatibility probe
7. Record
8. `dependency_overrides`
9. `pubspec.yaml` write contract

## 0. Flutter SDK — pinned to the DS

Every BUMA developer builds on the Flutter version `buma_design_system` pins in its `.fvmrc`
(`"flutter": "<x.y.z>"`) — that is the maximum. A newer SDK resolves but fails to compile the DS's
locked packages (`skeletonizer`, `syncfusion_flutter_*`, `google_fonts`).

- **Pin source.** The resolved DS checkout's `.fvmrc` (`rootUri` in `.dart_tool/package_config.json`).
  DS not resolved yet (new root): `git clone --depth 1 --branch release --no-checkout <DS url from
  SKILL.md step 2> <tmp>`, then `git -C <tmp> show HEAD:.fvmrc`; delete `<tmp>`.
- **Pin record.** The package's `.fvmrc` (`{"flutter": "<pin>"}`) records the pin for `--check`
  and the IDE. It is a plain JSON file — writing it needs no FVM. New project root or new feature
  package (its own new `pubspec.yaml`): write it before `flutter create` or the first `pub get`.
  Existing package: `.fvmrc` equals the pin → use it; missing or different → write the pin and
  record `harness: .fvmrc <old|missing> → <pin>`. **Never asked** — the DS fixes the SDK. Its
  `environment.sdk` above the pin's Dart (a `flutter create` on a newer SDK) → lower it to the
  pin's Dart (`^<x.y.z>`), recorded. A brief or report naming another Flutter than `.fvmrc` fails
  `--check`.
- **Runner — FVM is optional.** Read the global SDK once: `flutter --version --machine`
  → `frameworkVersion`.
  1. Global equals the pin → bare `flutter …` / `dart …`. No FVM needed.
  2. Global differs, `fvm` installed → `fvm install <pin>` (no-op when present), then every
     command as `fvm flutter …` / `fvm dart …`.
  3. Global differs, no `fvm` → true blocker. Ask with two options: `Install FVM (Recommended)`
     (`brew tap leoafarias/fvm && brew install fvm`, then rule 2) or `Switch the global Flutter
     to <pin>` (developer-side; re-check after). Never build on the global SDK.

  Below, `flutter`/`dart` means the runner picked here. New package: scaffold with that runner's
  `flutter create` so `environment.sdk` and lints match the pinned Dart.
- **Every command** — `pub get`, `analyze`, `format`, `test`, `run` — goes through that runner. One
  run on another SDK rewrites `.dart_tool/version` and `ios/Flutter/Generated.xcconfig`
  (`FLUTTER_ROOT`) to it, and the next Xcode build compiles the DS packages on it. `--check` fails
  on either file off the pin.
- **IDE.** It must run the same SDK, or its runs undo the pin the same way. Rule 1: nothing to
  set. Rule 2: point it at `.fvm/flutter_sdk` (VS Code/Cursor `"dart.flutterSdkPath":
  ".fvm/flutter_sdk"` in `.vscode/settings.json`; Android Studio → Flutter SDK path).
- Record `harness: flutter <pin> via global | fvm — Already present | Auto-installed`.

## 1. Phases

- **Detect + DS ensure (SKILL.md step 2).** Read what is resolved/wired. `buma_design_system`
  absent → write the fixed block from SKILL.md step 2 and `flutter pub get` immediately. It is the
  only early write, because component resolution reads its source on disk. Never ask for its
  URL/ref, never `BLOCKED` for it.
- **Apply once (before Dart generation, SKILL.md step 7).** Every pending write from §4, in one
  batch, exact diff recorded in `## Notes`.

**Under orchestration** detection and apply run once, at the orchestrator
([orchestration.md](orchestration.md) §1.4, §3). Frame workers skip this file.

## 2. Reuse a prior record — verified

An existing `specs/*/plan.md` with `harness:` lines is a claim, not proof. Grep `pubspec.yaml` for
each recorded package and `main.dart` for the recorded wrappers (`ScreenUtilInit`, `ProviderScope`,
`MaterialApp.router`). All match → copy the lines and skip detection. Anything reverted → treat it as
missing, note the revert.

## 3. Detect (read-only)

From `.dart_tool/package_config.json` and the bootstrap file (where `MaterialApp`/`CupertinoApp` is
built):

- **ScreenUtilInit** — app root wrapped? The DS uses `flutter_screenutil` (`.sp`/`.w`/`.h`) as a
  **transitive** dependency. Never add `flutter_screenutil` to the target `pubspec.yaml`; only the
  `ScreenUtilInit` wrapper is the target's job. Without it every `.sp`/`.w`/`.h` sizes wrong.
- **Routing** — two facts: is a routing package resolved (default `go_router`, constraint via
  screening priority), and does a registry exist wired into `main.dart`? A package without a
  registry stays pending.
- **State management** — static slicing needs none. `flutter_riverpod` is pending only when Figma
  states or an existing provider need `ConsumerWidget`.
- **Known issues** — `specs/_known-issues.md` if present: per row, grep `dependency_overrides` for
  the recorded fix. Present → resolved; missing → falls to the §6 probe.

Write a `harness:` line per item: `Already present` or `Pending (auto-apply before generation)`.

## 4. Collect pending writes (step 5)

Screen-driven needs append their own `Pending` lines:

- **`flutter_svg`** — the first `.svg` asset with no renderer resolved; constraint from the target,
  then the DS, then [package-inventory.md](package-inventory.md).
- **Asset category** — one `pubspec.yaml` line per new `assets/images/<category>/`
  (`flutter-resolve-assets` step 3).
- **`dependency_overrides`** — §8.
- External packages stay governed by [external-packages.md](external-packages.md), never
  auto-added; a missing one is a gap.

## 5. Apply

Automatically, before Dart generation; record the literal YAML and each constraint's source.

- **ScreenUtilInit / `ProviderScope`** — add the package if missing (never `flutter_screenutil`),
  `flutter pub get`, wrap `main.dart` as `ProviderScope` > `ScreenUtilInit` > `MaterialApp`/
  `CupertinoApp` (only missing wrappers; preserve title/theme/router config):

  ```dart
  ScreenUtilInit(
    designSize: UIResponsive.designSize(MediaQuery.of(context).size.width),
    minTextAdapt: true,
    ...
  )
  ```

  Never a hardcoded `Size(375, 812)`.
- **`flutter_svg`** — additive entry, `flutter pub get`; no wiring.
- **Routing (`go_router`)**:
  - add it if missing, `flutter pub get`;
  - create the registry in the visible `lib/` convention (`lib/core/`, `lib/router/`), else
    `lib/core/router/app_router.dart`:
    ```dart
    final GoRouter appRouter = GoRouter(
      initialLocation: '/',
      routes: [
        // additional routes are appended here as screens are sliced
      ],
    );
    ```
    Routes stay empty here; the screen's entry comes from [routing.md](routing.md);
  - `main.dart`: import it, `MaterialApp.router(routerConfig: appRouter, ...)` preserving every
    other argument, drop `home:`/`initialRoute`;
  - another router detected (e.g. `auto_route`) → use its registry, never install a second one; no
    safe insertion → true blocker under the Developer-question contract;
  - no approved constraint anywhere → true blocker, never an invented version.

`main.dart` and the router file are formatted/analyzed with the step 7 changed files.

## 6. Compatibility probe — every newly added package

Right after its `flutter pub get`, run `flutter analyze` on the target package, before Dart
generation.

- An error pointing outside the target feature (`.pub-cache`, third-party source) is a pre-existing
  SDK/dependency incompatibility, not a slice defect.
- Append a row to `specs/_known-issues.md` (create if missing): package + version, SDK constraint,
  exact error signature, root cause if known, fix applied or `unresolved`, date.
- A solver-proven fix → the minimal override (§8), applied with the batch. No fix → gap in
  `## Notes`, continue.

## 7. Record

Every `harness:` line ends `Already present`, `Auto-installed` (with source and exact
constraint/ref) or `Declined (gap)`. None stays `Pending`. An explicit developer override or decline
before apply wins; otherwise never ask.

## 8. `dependency_overrides`

Any `flutter pub get` here failing **version solving** (most often right after the DS dependency)
is carried to completion, never left as a report-only gap:

1. compute the minimal `dependency_overrides:` from the solver's conflict output;
2. prefer a matching constraint in [package-inventory.md](package-inventory.md); add nothing
   unrelated;
3. record the exact YAML as its own `harness:` line, apply, re-run `flutter pub get`.

Distinct from SKILL.md step 7's ban: overrides never chase a **pre-existing SDK/API
incompatibility** (a missing method inside a third-party package). They are the right tool only for
version solving of dependencies this workflow introduces.

**Never override a package the DS pins** (`skeletonizer`, `syncfusion_flutter_*`, `google_fonts`,
any package in the DS `pubspec.lock`). On the §0 pin the DS versions resolve and compile as-is; an
override for them means the SDK is wrong — fix the SDK (§0), not the package. An existing override
of a DS-pinned package that this workflow (or a prior slice) wrote with an SDK reason ("does not
compile on Flutter 3.x") is removed once the package is on the pin, then `flutter pub get` (§0 runner);
record `harness: removed override <pkg> (SDK pinned)`. Overrides a developer wrote for their own
reasons stay — report them, never delete. `--check` fails on any override of a DS-pinned package;
a developer-owned one is raised under the Developer-question contract, never left to pass.

## 9. `pubspec.yaml` write contract

Additive only, each write recorded with literal YAML, reason and constraint source. Never ask for
names, URLs, refs or versions: constraints come from the target `pubspec.yaml`, the resolved DS
checkout or [package-inventory.md](package-inventory.md). Existing constraints are never upgraded.
