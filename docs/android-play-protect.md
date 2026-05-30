# Cadencia Android / Play Protect

## Estado del APK

- App: Cadencia
- Package name: `com.cadencia.app`
- APK: `.tools/apk-audit/cadencia-sideload-v19-target34.apk`
- APK SHA-256: `02C494B337C558E5F883D0867130A57ABC4C145ACA52F48ED0B68AB8BFA8B838`
- Version code: `19`
- Version name: `0.1.0`
- Min SDK: `24`
- Target SDK: `34`
- Compile SDK: `36`
- Native ABI: `arm64-v8a`

## Firma

- Certificate DN: `CN=Cadencia, OU=Cadencia, O=Cadencia, L=Mexico City, ST=CDMX, C=MX`
- Certificate SHA-256: `16f74e32f500b7f51b38d4d5e494c64b44f4cdd33dd1da85734f75ade1f2829c`
- Public key SHA-256: `55334ace9a7a3154a1a8234eca6e16836d80d4565ca9d02ab3735de6b26a84d6`
- Key algorithm: RSA
- Key size: 4096 bits
- APK signing schemes: v2 and v3

## Permisos declarados

- `android.permission.INTERNET`
- `com.cadencia.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`

## Play Protect

La alerta vista en el telefono corresponde a la categoria oficial `Uncommon`:

> Play Protect hasn't seen an app from this developer before. It may be unsafe.

Para resolver esa senal fuera de Google Play, el camino oficial es registrar el package name y la llave de firma en Android Developer Console, o apelar la clasificacion de Play Protect si se considera un falso positivo.
