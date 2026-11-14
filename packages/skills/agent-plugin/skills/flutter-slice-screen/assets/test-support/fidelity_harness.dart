// Copied verbatim from the slice-screen skill (assets/test-support/fidelity_harness.dart).
// Never edit: `validate_output.py --check` fails a copy that differs. Render tests import it.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:buma_design_system/buma_design_system.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart'; // DS barrel does not export it
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

const _poppins = {
  'Poppins_100': 'Thin',
  'Poppins_200': 'ExtraLight',
  'Poppins_300': 'Light',
  'Poppins_regular': 'Regular',
  'Poppins_italic': 'Italic',
  'Poppins_500': 'Medium',
  'Poppins_600': 'SemiBold',
  'Poppins_700': 'Bold',
  'Poppins_800': 'ExtraBold',
  'Poppins_900': 'Black',
  'Poppins': 'Regular',
};

/// `setUpAll(loadDsFonts)`: DS Poppins under the family names google_fonts emits; no http fetch.
/// Without it every glyph is an Ahem box and a label measures ~2x its Figma width.
Future<void> loadDsFonts() async {
  GoogleFonts.config.allowRuntimeFetching = false;
  for (final e in _poppins.entries) {
    await (FontLoader(e.key)
          ..addFont(rootBundle.load('packages/buma_design_system/assets/fonts/Poppins-${e.value}.ttf')))
        .load();
  }
}

/// [frameWidth]: the Figma root frame width ([frameHeight]: its height, for the composed screen).
/// [sectionWidth]: the Figma section width, or null for the composed screen (then [child] is the
/// screen widget, which owns its own Scaffold). The section's height is never set: it must come
/// out at the Figma height on its own.
Future<void> pumpDs(WidgetTester tester, Widget child,
    {required double frameWidth, double? frameHeight, double? sectionWidth}) {
  // View = designSize at the Figma frame width: `.sp`/`.w`/`.h` are 1:1 with Figma px.
  // (UIResponsive.designSize(393) is 360 wide: a 361 section would not fit.)
  assert(sectionWidth == null || sectionWidth <= frameWidth, 'frameWidth is the Figma root frame width');
  final screen = Size(frameWidth, frameHeight ?? UIResponsive.designSize(frameWidth).height);
  tester.view.devicePixelRatio = 1.0;
  tester.view.physicalSize = screen;
  addTearDown(tester.view.reset); // omit and the size leaks into later tests
  final done = Completer<void>();
  runZonedGuarded(() async {
    await tester.pumpWidget(
      ScreenUtilInit(
        designSize: screen,
        minTextAdapt: true,
        builder: (_, __) => MaterialApp(
          home: sectionWidth == null
              ? RepaintBoundary(key: const Key('render'), child: child)
              : Scaffold(
                  body: Align(
                    alignment: Alignment.topLeft,
                    child: RepaintBoundary(
                        key: const Key('render'),
                        child: SizedBox(width: sectionWidth, child: child)),
                  ),
                ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    done.complete();
  }, (e, s) {
    // A DS-unshipped google_fonts variant only; every other error fails the test.
    if ('$e'.contains('was not found in the application assets')) return;
    if (!done.isCompleted) done.completeError(e, s);
  });
  return done.future;
}

/// After the golden, in the same pump: every `Key('<node-id>')` rect and every laid-out paragraph
/// (`textSize`: the line box Figma's TEXT node measures), relative to `Key('render')`, for
/// diff_renders.py. [path] is from the package root, where `flutter test` runs.
void writeLayout(WidgetTester tester, String path) {
  final origin = tester.getTopLeft(find.byKey(const Key('render')));
  List<double> rect(RenderBox b, Size size) {
    final o = b.localToGlobal(Offset.zero) - origin;
    return [o.dx, o.dy, size.width, size.height];
  }

  final id = RegExp(r'^I?\d+:\d+(;\d+:\d+)*$');
  final nodes = <String, List<double>>{
    for (final e in find
        .byWidgetPredicate((w) => w.key is ValueKey<String> && id.hasMatch((w.key! as ValueKey<String>).value))
        .evaluate())
      (e.widget.key! as ValueKey<String>).value:
          rect(e.renderObject! as RenderBox, (e.renderObject! as RenderBox).size),
  };
  final texts = [
    for (final p in tester.allRenderObjects.whereType<RenderParagraph>())
      {'text': p.text.toPlainText(), 'rect': rect(p, p.textSize)},
  ];
  File(path).writeAsStringSync(jsonEncode({'nodes': nodes, 'texts': texts}));
}
