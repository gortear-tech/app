# Play Protect unblock package

## Current APK

- App name: Cadencia
- Package name: `com.cadencia.app`
- Version: `0.1.0`
- Version code: `5`
- APK URL: `https://expo.dev/artifacts/eas/oi6oYuBi6J5KVmSJ9Kh9w5.apk`
- APK SHA-256: `8126BC11AF94D7000DC2246EF238AB9BD917ED9337B6A9352AACA82BBB8335E8`
- Signing certificate SHA-256: `16F74E32F500B7F51B38D4D5E494C64B44F4CDD33DD1DA85734F75ADE1F2829C`
- Target SDK: `36`
- Native architecture: `arm64-v8a`
- Size: `49.9 MB`

## Declared permissions

- `android.permission.INTERNET`
- `android.permission.ACCESS_NETWORK_STATE`
- `android.permission.ACCESS_WIFI_STATE`
- `android.permission.VIBRATE`
- `android.permission.READ_EXTERNAL_STORAGE`, limited to `maxSdkVersion=32`
- `android.permission.WRITE_EXTERNAL_STORAGE`, limited to `maxSdkVersion=32`
- `com.cadencia.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`

The APK does not request SMS, contacts, camera, microphone, accessibility, notification listener, overlay, phone, location, or account permissions.

## Play Protect appeal text

Use this text in the Play Protect Appeals Submission Form after uploading the APK to VirusTotal.

```text
Google Play Protect is blocking installation of my Android APK with a warning that the developer has not been seen before.

This appears to be an incorrect Play Protect classification for a private/internal distribution build.

App details:
- App name: Cadencia
- Package name: com.cadencia.app
- Version name: 0.1.0
- Version code: 5
- Target SDK: 36
- Native architecture: arm64-v8a
- APK SHA-256: 8126BC11AF94D7000DC2246EF238AB9BD917ED9337B6A9352AACA82BBB8335E8
- Signing certificate SHA-256: 16F74E32F500B7F51B38D4D5E494C64B44F4CDD33DD1DA85734F75ADE1F2829C

Security posture:
- The app uses HTTPS for production API traffic.
- The Android manifest has cleartext traffic disabled.
- The app targets Android SDK 36.
- The app only requests minimal permissions needed for network access, vibration, and photo selection compatibility on older Android versions.
- The app does not request SMS, contacts, camera, microphone, accessibility, notification listener, overlay, phone, location, or account permissions.
- The app is a business productivity tool for preparing and scheduling social media posts for pages managed by the user.

Please review and correct the Play Protect classification so users can install this APK without the "developer not seen before" block.
```

## Official steps

1. Upload the APK to VirusTotal.
2. Confirm the VirusTotal SHA-256 is exactly `8126BC11AF94D7000DC2246EF238AB9BD917ED9337B6A9352AACA82BBB8335E8`.
3. File the Play Protect appeal:
   `https://support.google.com/googleplay/android-developer/contact/protectappeals`
4. Register the package name for Android developer verification:
   - Package: `com.cadencia.app`
   - Public certificate SHA-256: `16F74E32F500B7F51B38D4D5E494C64B44F4CDD33DD1DA85734F75ADE1F2829C`

If Google asks for an ownership verification APK, it will provide a snippet for a file named `assets/adi-registration.properties`. Add that snippet to the app, rebuild, and upload the signed APK they request.
