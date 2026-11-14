---
name: flutter-run-verify
description: Catch and fix Flutter runtime layout exceptions — RenderFlex overflow, BoxConstraints forces an infinite height/width, unbounded viewport, notch/safe-area overlap, large text scale — headless with a multi-viewport widget render test (no emulator, any OS), then on an available device (iOS simulator, Android emulator, device) with pub get, analyze and debug-console auto-fix for native build/plugin/dependency failures, looping until the target screen renders with zero exceptions, with log + screenshot evidence. Use after slicing or any UI change to verify the screen actually renders, not just analyzes; do not use for writing features or business logic. Only applies to repos containing `pubspec.yaml`.
---

# Flutter Run & Verify

Contract: **"beres" = the headless render test (§2) green, with its log on disk** → `PASS
(headless)`. It runs on any OS in seconds, no simulator/emulator. Layout, safe area, text scale and
assets are fidelity and are proven there; `--check` already proves asset files and pubspec entries
statically.

After the headless pass, the app **runs on an available device** (§3–§5), no question: it adds
what a widget test cannot see — native build (pod/gradle), platform-channel plugins, launch
crashes, the debug console. In a batch the orchestrator runs it once. No device → `run: skipped
(no device)`, never a blocker for the headless `PASS (headless)`.

Any blocker (missing tooling, unreachable screen) is recorded `BLOCKED` — never folded into "tests
passed".

## 1. Locate & preflight

1. Package root = nearest `pubspec.yaml`. Every `flutter`/`dart` command below runs on the
   [environment.md](../flutter-slice-screen/references/environment.md) §0 runner (global SDK when it equals
   the `.fvmrc` pin, else `fvm`). No `.fvmrc` and the DS-pinned SDK missing → apply
   [environment.md](../flutter-slice-screen/references/environment.md) §0 before building; never run the DS
   on a newer SDK.
   After a slice, run `python3 <flutter-slice-screen>/scripts/validate_output.py --check <feature-dir>`
   first; it must pass (it also catches an SDK off the pin, a `BLOCKED` worker report and an
   unrendered section). A failing `--check` → stop and report it; never build past it.
2. `flutter pub get`; with an `ios/` folder, `flutter build ios --config-only --no-codesign`
   (regenerates `Generated.xcconfig` on the pin), and `ios/Podfile.lock` missing/stale → `pod
   install --repo-update` in `ios/` before the first build.
3. `flutter analyze --no-fatal-infos <package-root>` as baseline: fix every *error* and the lints
   the slice caused (`depend_on_referenced_packages` → add the package as a direct dependency within
   the DS constraint); other warnings/infos are recorded, not gated. A pre-existing SDK/API error outside the code under verification is recorded, not
   fixed.

**`flutter analyze` is static.** Overflow, infinite constraints, missing assets and unbounded
scrollables only happen while layout runs. A clean analyze is a starting line, never evidence.

## 2. Render test — the verification

Layout exceptions come from the same `RenderObject` code in a widget test, with the same message
text. Catch them here in seconds, on any OS.

One **persistent** render test per screen, `<screen>_render_test.dart`, separate from fidelity and
component tests. Run that exact file and capture its output to a log; a directory run or another
widget's test does not certify this screen.

```dart
// test/.../<screen>_render_test.dart — exception detection only, not Figma comparison
for (final logical in const [Size(320, 568), Size(390, 844), Size(393, 852), Size(430, 932)]) {
  testWidgets('renders clean at $logical', (tester) async {
    tester.view.devicePixelRatio = 3.0;
    tester.view.physicalSize = logical * 3.0;
    addTearDown(tester.view.reset);            // omit and the size leaks into later tests

    await tester.pumpWidget(/* app root wrapping the screen, same ScreenUtilInit as main.dart */);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    // Figma cuts no text unless the node has truncate: every label renders in full.
    for (final p in tester.renderObjectList<RenderParagraph>(find.byType(RichText))) {
      expect(p.didExceedMaxLines, isFalse, reason: p.text.toPlainText());
    }
  });
}

// Notch + home indicator (iPhone 14 Pro insets) and a large system font — what a device showed.
testWidgets('safe area + text scale 1.3', (tester) async {
  tester.view.devicePixelRatio = 3.0;
  tester.view.physicalSize = const Size(393, 852) * 3.0;
  tester.view.padding = const FakeViewPadding(top: 59 * 3, bottom: 34 * 3);
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MediaQuery(
    data: MediaQueryData.fromView(tester.view).copyWith(textScaler: const TextScaler.linear(1.3)),
    child: /* same app root */,
  ));
  await tester.pumpAndSettle();
  expect(tester.takeException(), isNull);
  // first section clears the status bar; last clears the home indicator
  expect(tester.getTopLeft(find.byKey(const Key('<first section id>'))).dy, greaterThanOrEqualTo(59));
});
```

`--check` requires `FakeViewPadding(` and `TextScaler.linear(` in the render test. A screen that
scrolls under a transparent app bar by design asserts that instead, with one `## Notes` line.

393 is the tightest text case: ScreenUtil scales `.sp` ~1.09× there while fixed widths stay
([ds-api.md](../flutter-slice-screen/references/ds-api.md) §Responsive). `RenderParagraph` needs
`import 'package:flutter/rendering.dart';`.

Use real device sizes, smallest first: a test pinned to the app's `designSize` cannot overflow at
1:1 scale, so it stays green whatever the screen holds. (The fidelity test does use `designSize`;
hence two files.)

Green means `takeException()` is null **and** the captured log has zero matches for the step 4
grep (some errors reach stderr without a non-zero exit). Loop: fix, re-run the exact file.

Green here = `PASS (headless)`: the screen is verified; report per §6 and stop. Blank-box icons
show in the golden pair (`flutter-verify-fidelity` §6), DS fonts load in the test (`loadDsFonts`). Left
for the device run (§3): pod/gradle, platform-channel plugins, launch crashes.

## 3. Real runner — after the headless pass

1. **Device**: `flutter devices --machine`, first mobile device/simulator that is up (iOS
   simulator on macOS, else Android). None up → boot one: `xcrun simctl boot <udid>` (first
   available iPhone) or `flutter emulators --launch <id>`. None at all → `run: skipped (no device)`.
   The developer naming a runner overrides this pick.
2. **Run**: `flutter run -d <id> --route <screen route>` (or the deep link, §5), output captured to
   `build/run-verify/run.log`; wait for the first frame plus 15 s, then quit (`q`).
3. **Debug console**: errors are `EXCEPTION CAUGHT`, `overflowed`, `Unhandled Exception`,
   `Error (Xcode)`, `FAILURE: Build failed`, plus the §4 grep. Xcode/gradle *warnings*
   (`Run script build phase`, deprecated APIs in pods) are noise: listed once, never fixed.
4. **Auto-fix**, then a fresh `flutter run`, up to 3 rounds; still failing → `run: BLOCKED <first
   error>`. Allowed, no question: Dart errors in the slice; an overflow (then re-score the section,
   `diff_renders.py`); `pub get` / `pub upgrade <pkg>` within the DS constraint; a missing direct
   dependency; `pod install --repo-update`; the `Podfile` `platform :ios` raised to the DS minimum.
   Never: `dependency_overrides`, changing the Flutter pin or the DS ref, `--major-versions`,
   `// ignore:`, weakening a test, editing files outside the slice other than `pubspec.yaml`/`Podfile`.
5. **Record** in `plan.md` `## Notes`: `- run: PASS <device>` | `- run: skipped (no device)` |
   `- run: BLOCKED <reason>` — `--check` fails `run: BLOCKED`. Every edited file is listed in the
   report.

## 4. Fix loop

```
render test green at every viewport (seconds)  → red? classify → fix → re-run
then per runner: boot if needed → flutter run -d <id> (capture full output)
  → clean? evidence (step 5)   → error? classify → fix → fresh `flutter run`, not hot reload
```

Classify and fix:

- **Dart compile/analyze errors** — fix the source.
- **Version solving** — in a slice, the `dependency_overrides` section of
  [environment.md](../flutter-slice-screen/references/environment.md); standalone, the minimal override
  (fix scope covers `pubspec.yaml`), listed in the report.
- **iOS deployment target** (`IPHONEOS_DEPLOYMENT_TARGET is set to 9.0, but the range ... is 12.0
  to …`) — merge into the existing `post_install` (never a second block), then `pod install`:
  ```ruby
  post_install do |installer|
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '12.0'
      end
    end
  end
  ```
- **Android gradle** — minSdk/compileSdk/AGP: apply the version the error names, in the file it
  names.
- **Launch crash / red screen** — fix the widget the stack trace names.
- **Runtime render exception** — Flutter prints it and keeps running. Never judge by exit code; grep
  the captured log:
  ```bash
  grep -niE 'EXCEPTION CAUGHT BY|A RenderFlex overflowed by|BoxConstraints forces an infinite|unbounded height|unbounded width|Incorrect use of ParentDataWidget|Unable to load asset|setState\(\) called during build|Failed assertion|Another exception was thrown|RenderBox was not laid out|Vertical viewport was given unbounded height|Cannot hit test a render box' run.log
  ```
  Zero matches is required but not sufficient (zero-extent row below). `Another exception was
  thrown` is one root cause repeated. Fix the root cause at the named widget:

  | Message | Root cause | Fix at the widget |
  |---|---|---|
  | `A RenderFlex overflowed by N pixels` | a `Column`/`Row` child wants more than the axis has | make the flexible child `Expanded`/`Flexible`; scroll only if the design scrolls |
  | `BoxConstraints forces an infinite width/height` | a child with no intrinsic size on that axis in an unbounded axis | bound it — see below |
  | `Vertical viewport was given unbounded height` | `ListView`/`GridView`/`SingleChildScrollView` in an unbounded parent | `Expanded` around it, or `shrinkWrap: true` + `NeverScrollableScrollPhysics()` for a short fixed list |
  | `RenderBox was not laid out` | downstream of the exception printed above it | fix that one |
  | `Incorrect use of ParentDataWidget` | `Expanded`/`Flexible`/`Positioned` outside `Flex`/`Stack` | move it under the right parent, or drop it |
  | `Unable to load asset: "<path>"` | path absent from disk or `pubspec.yaml` | fix the path / declare it — never a placeholder box |
  | `setState() called during build` | state mutated in `build` | move to `initState`, a callback or `addPostFrameCallback` |
  | **no message**, region blank or shorter than Figma | a subtree at **zero extent** (legal, silent) | find the collapsed ancestor: `Expanded` under an unbounded axis, a `Stack` of only `Positioned`, a `SizedBox` from a mis-read token |

  **Infinite constraints — canonical fix.** One-axis DS components (`UIDivider`, progress bars,
  skeletons, background fills) are thin on one axis and expect the parent to bound the other. In an
  unbounded `Row`/`Column`, or one nested in a same-axis scroll view, they ask for infinity. Bound
  that axis, in order:
  1. `Expanded`/`Flexible` under a `Flex` with a bounded main axis — keeps fill behaviour;
  2. `SizedBox(width:)`/`SizedBox(height:)` when Figma specifies the extent;
  3. `IntrinsicHeight`/`IntrinsicWidth` only when siblings must share one extent — expensive.

  Never hardcode a size Figma does not specify, never delete the component.
- **Noise** (`Run script build phase … will be run during every build`) — listed once, never
  "fixed" in Xcode project files.

Loop rules:

- Re-run after **every** fix.
- No iteration budget: keep going while each iteration resolves a *distinct* exception.
- Stuck guard: the same error text survives two consecutive fixes, or 5 attempts on one error →
  stop and report what was tried. Never claim "beres" to exit.
- `flutter clean` only when a fix requires it (e.g. pod re-integration).

## 5. Definition of done

Once per screen: the render test is green at every viewport and the safe-area/text-scale case,
exit 0, log clean, both paths recorded — `PASS (headless)`. Then, on the §3 device (or each
runner the developer named):

1. `flutter run` reaches a first frame with zero errors in the captured log.
2. **The target screen is on screen** — via deep link (`adb shell am start -a
   android.intent.action.VIEW -d "<scheme>://<route>"`, `xcrun simctl openurl booted
   "<scheme>://<route>"`), tapping the real navigation path, or, last resort, a temporary router
   initial-location edit that is reverted before the report and named in it. Keep capturing while
   it settles and scrolls end to end, then re-run the grep on that post-navigation log.
   Unreachable screen is a failure, not a pass.
3. Screenshot from the runner (`xcrun simctl io booted screenshot <path>`, `adb -s <id> exec-out
   screencap -p > <path>`) saved to `specs/<ID>-<slug>-<DD_MM_YYYY>/renders/run-<runner>.png`
   for a slice, else `build/run-verify/<runner>.png`; scrolled states one file each. No file = not
   verified. Shrink it before viewing it — the capture is physical pixels (3×), ~3× the image tokens
   for no layout detail. Longest side to 852, shrink only (`sips -Z` also enlarges):
   `[ "$(sips -g pixelHeight <path> | awk '/pixelHeight/{print $2}')" -gt 852 ] && sips -Z 852 <path>`
   (macOS; portrait capture, height is the long side) or `magick <path> -resize '852x852>' <path>`.
   Neither tool → view it as is; never install one for this.
4. The screenshot shows **the target screen** (not home, splash or an error), every section, no
   blank or shortened region, and every icon/image as a real graphic — a solid box means an invalid
   asset or placeholder: fix it per `flutter-resolve-assets` steps 5 and 8.

## 6. Report

- Status: exactly `PASS (headless)`, `PASS` (headless + the device run) or `BLOCKED`.
- Per screen: render-test path/command, test-log path, clean or not; "not run on a device:
  native build and plugins unchecked" when no device was available.
- Per runner: launched clean, run-log path, screenshot paths, iterations, how the screen was reached
  (and the revert confirmation for an initial-location edit), post-navigation grep result.
- Every file the loop edited, one-line reason each; residual noise; anything unresolved as
  `BLOCKED`.

## Boundaries

- Presentation/build-config fixes only — no features, business logic, API, domain or repository.
- Never hand-edit Xcode `project.pbxproj`/workspace files; pods are fixed via `Podfile` +
  `pod install`.
- Never uninstall/downgrade tooling (Xcode, SDKs, AVDs); report the gap.
- Machine-side actions are only §3's: boot an existing simulator/emulator, `pod install`, the
  `Podfile` platform line. Never create an AVD/simulator or install tooling.
