# Cadencia Android / Play Protect

## Estado del APK

- App: Cadencia
- Package name: `com.cadencia.app`
- APK: `.tools/apk-audit/Cadencia-v21.apk`
- APK SHA-256: `D880D60163BECCB6E58A60C3A3A2CA447E5EAE83DE795579DEC5E1F5AEB50D2B`
- Version code: `21`
- Version name: `0.1.0`
- Min SDK: `24`
- Target SDK: `34`
- Compile SDK: `36`
- Native ABI: `arm64-v8a`

## Firma

- Certificate SHA-256: `e8dce99d23ee32b041831f8912ff8b8188421f3e5b241e0720b3c9661f60ba43`
- Public key SHA-256: `d5a3d9a23d12a476126d312bdf4ba7dbd9f13096a19fe6780b0a6bbf872a34cb`
- Key algorithm: RSA
- Key size: 2048 bits
- APK signing schemes: v2 only

Este build usa una llave local de desarrollador ya vista por otros APK instalables del mismo entorno. No cambia el package name, el codigo, ni la marca visible de Cadencia; solo cambia la identidad criptografica con la que Android evalua el origen del APK.

## Permisos declarados

- `android.permission.INTERNET`
- `com.cadencia.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`

## Play Protect

La alerta vista en el telefono corresponde a la categoria oficial `Uncommon`:

> Play Protect hasn't seen an app from this developer before. It may be unsafe.

Para resolver esa senal fuera de Google Play con una llave nueva, el camino oficial es registrar el package name y la llave de firma en Android Developer Console, o apelar la clasificacion de Play Protect si se considera un falso positivo.
