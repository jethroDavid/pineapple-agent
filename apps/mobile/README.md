# Mobile App

Expo development-build app for assistant audio streaming.

## Setup

```bash
pnpm install
```

Set the backend base URL before starting Expo:

```bash
# PowerShell
$env:EXPO_PUBLIC_API_BASE_URL="http://<your-local-ip>:3000"
```

Use the right host per runtime:
- Android emulator: `http://10.0.2.2:3000`
- iOS simulator: `http://localhost:3000`
- Physical device: `http://<your-local-ip>:3000`

## Run (Simplest)

```bash
pnpm --filter mobile exec expo start -c
```

Open the installed Android development build. Expo Go is not the target for lock-screen playback.

## Run (Native Android Build)

Use this only when native Android code/dependencies changed:

```bash
pnpm install --config.confirmModulesPurge=false
pnpm --filter mobile exec expo prebuild --platform android --no-install
pnpm --filter mobile exec expo run:android
pnpm --filter mobile exec expo start -c
```

## Why Multiple Commands?

- `pnpm install`: dependency install/update
- `expo start -c`: Metro bundler with cache reset
- `expo prebuild`: applies native config plugins such as `expo-audio`
- `expo run:android`: native Android build/install step (not needed for every JS-only change)

## Flow

1. Enter prompt text.
2. Tap the power button.
3. The app polls until TTS is ready.
4. Playback starts automatically from `GET /adapters/assistant-audio-bridge/requests/:requestId/audio`.

Audio uses `expo-audio` with Android background playback enabled. The Android native project must include `AudioControlsService` and the foreground media playback permission for screen-lock playback.
