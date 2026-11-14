# Approved Flutter package inventory

Fallback constraints copied from BUMA features already running in production. Use only after the
target project and resolved `buma_design_system` `pubspec.yaml` have no declaration for the required
package. Copy the constraint exactly; never upgrade it during slicing. `flutter_screenutil` is listed
for reference only — it arrives transitively through the DS and is never added to the target
([environment.md](environment.md) §3).

```yaml
flutter_riverpod: ^2.3.6
riverpod_generator: ^2.3.5
riverpod_annotation: ^2.1.1
flutter_screenutil: ^5.9.3
percent_indicator: ^4.2.3
syncfusion_flutter_charts: 23.2.4
syncfusion_flutter_sliders: 23.2.4
syncfusion_flutter_core: 23.2.4
syncfusion_flutter_gauges: 23.2.4
fl_chart: 1.0.0
go_router: ^10.0.0
internet_connection_checker: ^1.0.0+1
flutter_svg: ^2.0.7
intl: ^0.18.0
isar_community: *isar_version
isar_community_flutter_libs: *isar_version
path_provider: ^2.1.0
flutter_carousel_widget: ^3.0.1
dio: ^5.3.2
flutter_dotenv: ^5.1.0
flutter_switch: ^0.3.2
geocoding: ^2.1.0
geolocator: ^10.0.1
easy_tooltip: ^0.1.0
dropdown_button2: ^2.3.9
visibility_detector: ^0.4.0+2
tutorial_coach_mark: 1.2.9
url_launcher: ^6.1.14
easy_debounce: ^2.0.3
scroll_date_picker: 3.7.3
flutter_background_service: ^5.0.2
flutter_local_notifications: ^15.1.0+1
ntp: ^2.0.0
location: ^5.0.3
timeline_tile: ^2.0.0
flutter_widget_from_html_core: ^0.15.2
syncfusion_flutter_datagrid: 23.2.4
lazy_load_indexed_stack: ^1.0.1
icon_decoration: ^2.0.2
cached_network_image: ^3.3.1
just_the_tooltip: ^0.0.12
screenshot: 2.1.0
image_gallery_saver: ^2.0.3
android_intent_plus: ^5.0.2
share_plus: 7.2.2
restart_app: ^1.2.1
photo_view: ^0.15.0
back_button_interceptor: 6.0.1
shimmer: ^3.0.0
flutter_sticky_header: ^0.7.0
scrollable_positioned_list: ^0.3.8
webview_flutter: 4.10.0
get_it: ^8.0.3
injectable_generator: ^2.4.2
permission_handler: ^11.4.0
device_info_plus: ^9.1.2
syncfusion_flutter_pdfviewer: ^23.2.4
lottie: ^2.7.0
carousel_slider: ^5.0.0
linked_scroll_controller: 0.2.0
sliver_tools: ^0.2.12
native_device_orientation: ^2.0.3
posthog_flutter: ^5.0.6
image: ^4.1.7
```

Approved fallback overrides, applied only when `flutter pub get` reports the matching version-solving
conflict. Never add them pre-emptively, and never one for a DS-pinned package (`skeletonizer`,
`syncfusion_flutter_*`) — that conflict means the SDK is off the DS pin ([environment.md](environment.md) §0, §8):

```yaml
dependency_overrides:
  value_layout_builder: ^0.5.0
  chucker_flutter: ^1.9.1
  share_plus: ^12.0.1
```

`*isar_version` is a symbolic placeholder from the source application, not a valid version constraint
by itself. Resolve the target project's `isar_version` mechanism first. If none exists, report that
package as unresolved instead of writing the placeholder.
