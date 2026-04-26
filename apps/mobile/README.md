# Mobile App

Expo development-build app for assistant audio streaming.

## Setup

```bash
pnpm install
```

Set backend URL before starting the app:

```powershell
# PowerShell
$env:EXPO_PUBLIC_API_BASE_URL="http://<your-local-ip>:3000"
```

```bash
# bash/zsh
export EXPO_PUBLIC_API_BASE_URL="http://<your-local-ip>:3000"
```

Host guide:
- Android emulator: `http://10.0.2.2:3000`
- iOS simulator: `http://localhost:3000`
- Physical Android device: `http://<your-local-ip>:3000`

If you run `pnpm dev:easy` at repo root, the mobile base URL is auto-synced.

Expo Go is not used for this app; use a development build or release APK.

## Track Changes Before You Build

```bash
git status --short
```

Use this before and after each build/rebuild so you can quickly spot:
- source changes you intended
- generated files you should ignore
- build output you should not commit

## Development Workflow

For JS/TS-only changes (most edits), do not rebuild native:

```bash
pnpm --filter mobile exec expo start --dev-client
```

If Metro cache is stale:

```bash
pnpm --filter mobile exec expo start --dev-client -c
```

## Rebuild For Development

Rebuild the Android development app when native config/dependencies change:
- `app.json` plugin/native settings
- `package.json` native module changes
- anything under `apps/mobile/android` (if committed)

```bash
pnpm install --config.confirmModulesPurge=false
pnpm --filter mobile exec expo prebuild --platform android --no-install
pnpm --filter mobile exec expo run:android --device
pnpm --filter mobile exec expo start --dev-client -c
```

## Build For Release (Android)

From repo root:

```bash
pnpm install --config.confirmModulesPurge=false
pnpm --filter mobile exec expo prebuild --platform android --no-install
cd apps/mobile/android
./gradlew.bat clean
./gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Release APK output:
- `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`

Install to device:

```bash
adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

## App Flow

1. Enter prompt text.
2. Tap the power button.
3. The app polls until TTS is ready.
4. Playback starts automatically from `GET /adapters/assistant-audio-bridge/requests/:requestId/audio`.
