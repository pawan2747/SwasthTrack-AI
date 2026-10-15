# SwasthTrack mobile app (Flutter, Android + iOS)

A Hindi-first family health tracker for an elderly parent and their caregivers:
blood pressure, weight, steps, sleep, medicines, food and alerts. It is a client
for the SwasthTrack server in the parent directory (Next.js + MySQL); it has no
database of its own and no AI key.

- Bilingual: Hindi and English side by side (default), or English only, or Hindi only.
- Large, calm UI; works with the system text size; every screen scrolls.
- Light theme only, Material 3, system fonts (Devanagari renders everywhere).
- Only three packages: `http`, `flutter_secure_storage` (the sign-in token lives
  in the Keychain / Android Keystore) and `cupertino_icons`.

| | |
|---|---|
| Flutter / Dart | 3.47.7 stable / 3.13 |
| Android | `applicationId` `com.swasthtrack.app`, `minSdk` 24, `compileSdk`/`targetSdk` 36 |
| iOS | bundle id `com.swasthtrack.app`, deployment target 15.0 (the Flutter 3.47 engine itself requires iOS 15) |

## What the app does

1. **Sign in**: password, or an e-mailed 6-digit code; create an account (name, e-mail,
   password, then the code); forgot password (code + new password). The session is
   restored on launch. A "Server address" section on the sign-in screen and in
   More lets you point the app at another server.
2. **First run**: create a patient profile, or join one with an 8-character
   caregiver code.
3. **Home**: status card from the server's alert engine (same rules as the web
   dashboard and the e-mails), today's medicines with one-tap "Mark as taken",
   latest BP and weight, today's steps, sleep and calories against the targets.
   Pull down to refresh. Patient switcher when the account has several patients.
4. **Health**: BP, weight, steps and sleep: trend chart (drawn with
   `CustomPainter`), recent entries, add, edit and delete.
5. **Medicines**: today's schedule, mark taken / missed / undo with the web app's
   rules (late after 3 hours, "missed" after 4 hours, empty-stomach morning
   medicines late from 10:00), 7-day adherence, add and stop medicines.
6. **Food**: meals grouped by meal type, calories against target, search the
   Indian food catalogue, pick a portion and count (or grams), save, delete.
   Browse earlier days.
7. **Alerts**: every alert for the patient, in Hindi and English, colour-coded.
8. **More**: profile name, patients, care team (the owner can list members,
   create a 15-minute caregiver code, and remove access), language, server
   address, about and the medical disclaimer, sign out.

Viewers (read-only members) see everything but no add / edit / delete controls,
and a clear note. Owners and editors can write. The server enforces this too.

"Today" is always **India time** (UTC+5:30), whatever the phone's zone is.

## Pointing the app at a server

The default address is `https://swasth-track-ai.vercel.app`.

```bash
# at build or run time
flutter run --dart-define=API_BASE_URL=https://your-server.example.com
flutter build apk --release --dart-define=API_BASE_URL=https://your-server.example.com
```

or, without rebuilding: sign-in screen (or More) then **Server address** and Save.
The address is kept on the phone.

Plain `http://` works only in **debug** builds on Android (cleartext is allowed
only in `android/app/src/debug/AndroidManifest.xml`) and for local-network hosts
on iOS (`NSAllowsLocalNetworking`). A release build must use `https://`.

From the Android emulator, the computer's `localhost` is `10.0.2.2`:

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

## Run on an emulator or a phone

```bash
cd mobile
flutter pub get
flutter devices
flutter run                 # picks the connected device / emulator
```

## Checks

```bash
flutter analyze             # must print: No issues found!
dart format --set-exit-if-changed lib test
flutter test
```

The tests use real server answers captured from the demo server
(`test/fixtures/*.json`, synthetic data only) and a fake HTTP client, so they
never touch the network.

## Build

### Android APK

```bash
flutter build apk --debug      # build/app/outputs/flutter-apk/app-debug.apk
flutter build apk --release    # build/app/outputs/flutter-apk/app-release.apk
flutter build appbundle        # build/app/outputs/bundle/release/app-release.aab (Play Store)
```

Needs JDK 17, the Android SDK (platform 36, build-tools 36) and the NDK that
Gradle downloads on the first build. The first build downloads a lot and can
take a long time.

> **Release signing.** So that `flutter build apk --release` works with no
> keystore, the release build type is signed with the **debug** key
> (`android/app/build.gradle.kts`). Such an APK is for testing only and cannot be
> uploaded to the Play Store. Before publishing:
>
> 1. Create an upload key (keep it and its passwords private, never commit them):
>    `keytool -genkey -v -keystore ~/swasthtrack-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`
> 2. Create `android/key.properties` (already git-ignored by `android/.gitignore`):
>    ```
>    storePassword=...
>    keyPassword=...
>    keyAlias=upload
>    storeFile=/Users/you/swasthtrack-upload.jks
>    ```
> 3. In `android/app/build.gradle.kts` load that file and add a `release`
>    `signingConfigs` entry, then use it in `buildTypes { release { ... } }`
>    instead of `signingConfigs.getByName("debug")`.
>    See https://docs.flutter.dev/deployment/android#sign-the-app
> 4. `flutter build appbundle` and upload the `.aab` in the Play Console.

### iOS (on a Mac with Xcode)

Xcode was not available where this project was written, so the iOS project was
configured by hand and **has not been built**. On your Mac:

```bash
# 1. Install Xcode from the App Store, then:
sudo xcodebuild -license accept
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer

# 2. Install CocoaPods if you do not have it
sudo gem install cocoapods     # or: brew install cocoapods

# 3. Fetch packages and the iOS pods
cd mobile
flutter pub get
cd ios && pod install && cd ..

# 4. Open the workspace, choose your team under
#    Runner > Signing & Capabilities > Team, and (if needed) change the bundle id
open ios/Runner.xcworkspace

# 5. Run on a device / simulator, or build an archive for TestFlight
flutter run
flutter build ipa
```

Notes:

- Bundle id `com.swasthtrack.app`, display name `SwasthTrack`, deployment target
  iOS 15.0 (set in the Xcode project and `ios/Podfile`).
- `Info.plist` allows plain HTTP only for local-network hosts
  (`NSAllowsLocalNetworking`); everything else must be HTTPS.
- Keychain storage needs no extra entitlement for a normal app.
- The app does not use the camera, photos, location or notifications, so no
  usage strings are needed.

## Project layout

```
lib/main.dart                 entry point
lib/src/config.dart           default server address, timeouts
lib/src/ist.dart              India-time helpers (istNow, istDate, istDayBounds ...)
lib/src/strings.dart          every Hindi + English text
lib/src/theme.dart            colours and Material 3 theme
lib/src/api/                  ApiClient (cookie, JSON, timeouts), DbClient (query builder),
                              AuthApi, AlertsApi, FoodsApi, HealthRepository, session store
lib/src/models/               hand-written, defensive fromJson
lib/src/logic/                BP rules and validators, dose rules, food maths
lib/src/state/app_state.dart  ChangeNotifier + InheritedNotifier (no state package)
lib/src/ui/                   screens and widgets
test/                         unit and widget tests, fixtures captured from the server
```

## How it talks to the server

- Every POST is `Content-Type: application/json` (the server's cross-site guard
  accepts that from a client with no `Origin`).
- Sign-in answers set the `st_session` cookie; the app reads it from the raw
  `Set-Cookie` header, keeps it in secure storage and sends
  `Cookie: st_session=<token>` afterwards. A 401 anywhere (other than a wrong
  password at sign-in) clears the token and shows sign-in.
- Data goes through `POST /api/db` (`{query}` / `{rpc}`), exactly like the web
  app, so the server's access rules apply unchanged. Alerts come from
  `GET /api/alerts`, foods from `GET /api/foods`.
- Every request has a 20 second timeout and a friendly bilingual error with Retry.

## Known limits

- iOS has not been built or run (no Xcode where this was written).
- Android: `flutter build apk` (debug and release) succeeds, and the app was run on an
  Android 14 (API 34) emulator against a test server: sign-in, session restore, alerts,
  marking a dose, adding a BP reading, adding food, the patient list, and (release build)
  an HTTPS sign-in refusal. It has not been tried on a physical phone.
- The server must run THIS repository's backend: `GET /api/alerts` and `GET /api/foods`
  were added together with the app. An older deployment answers 404, so Home shows
  "alerts unavailable" (with Retry) and food search fails with a retry message.
- E-mailed codes depend on the server's mail setup; it was not exercised end to end.
- No push notifications or background reminders (alerts show when the app opens
  and when it returns to the foreground).
- No photo features (BP/weight display reading, food photos) of the web app.
- No offline mode: without a connection the app shows a retry message.
- Medicines can be added and stopped, not edited; per-patient settings (targets,
  alert switches) are read, not changed, in this version.
- Date and time pickers use Material's built-in English labels.
- The launcher icon is a simple generated heart; replace it before publishing
  if you have the real artwork.

This app does not diagnose. Consult a doctor for medical decisions. In an
emergency call 112.
