# FBmaniaco

Monorepo base for the FBmaniaco V2 platform.

## Structure

- `apps/api` - Fastify backend
- `apps/mobile` - Expo / React Native client
- `apps/worker` - BullMQ background worker
- `packages/shared` - shared contracts and types
- `packages/providers` - provider interfaces and mocks
- `packages/motor-perron` - pure intelligence engine

## Notes

- No secrets are committed to the repo.
- Production tokens and service credentials must live in environment variables.
- The initial implementation is organized around the real Meta pages flow, not a demo mode.

## Install on a phone without depending on this PC

For daily use, deploy the API to a public host first. The included `render.yaml` and `Dockerfile` are ready for Render with a persistent disk. See [DEPLOY.md](DEPLOY.md).

Once the API is public, build the app with:

```powershell
$env:API_URL="https://your-fbmaniaco-api.onrender.com"
$env:APP_VARIANT="production"
pnpm --filter @fbmaniaco/mobile build:android:production
```

The installed app will then talk to the public API instead of this computer.

## Local install on a phone

### Android

1. Find the LAN IP of your PC, for example `192.168.1.34`.
2. Start the API so the phone can reach it on the network:
   `pnpm --filter @fbmaniaco/api dev`
3. Set `EXPO_PUBLIC_API_URL` to the LAN IP before building, for example `http://192.168.1.34:4101`.
   - If you use a local build, export it in the same PowerShell session before running EAS.
   - If you use the EAS cloud build, set the same variable in your EAS environment.
   - If you prefer a file, create `apps/mobile/.env` with only `EXPO_PUBLIC_API_URL=...`.
   - PowerShell example:
     ```powershell
     $env:EXPO_PUBLIC_API_URL="http://192.168.1.34:4101"
     ```
4. From the repo root, verify that EAS CLI is available:
   `npx eas-cli --version`
5. Log in and build an installable APK:
   `pnpm --filter @fbmaniaco/mobile build:android`
6. Install the APK that EAS gives you on the phone.

### iPhone

1. You need an Apple Developer account for a real install on device.
2. Keep the API reachable from the phone, just like on Android.
3. Build with EAS:
   `pnpm --filter @fbmaniaco/mobile build:ios`
4. Follow the EAS prompts to register the device or distribute the build.

### Important

- The installed app cannot use `localhost` to reach the API.
- If the phone and PC are on the same Wi-Fi, use the PC LAN IP.
- The API must be running on `0.0.0.0:4101` so the phone can reach it.
- If you want to use the app outside your local network, the API must be deployed to a public URL.
