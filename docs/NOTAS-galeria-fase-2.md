# Notas de implementacion - Galeria Fase 2

- Decision de sync: se adopta PowerSync con `@powersync/react-native` y `@powersync/op-sqlite`, siguiendo el setup vigente del SDK. La app no lo activa hasta que exista `EXPO_PUBLIC_POWERSYNC_URL`; mientras tanto usa REST + cache local + cola offline para mantener la galeria funcional.
- El esquema cliente esta en `apps/mobile/src/data/powersync.ts` y las reglas iniciales del servicio estan en `apps/api/powersync/sync_rules.yaml`.
- Dedup: el cliente calcula SHA-256 sobre bytes reales decodificados desde el archivo local, no sobre el string base64, para que coincida con la verificacion del worker.
- Escrituras: uploads, selecciones y metadata siguen pasando por endpoints REST para respetar validaciones, signed URLs y jobs existentes. El `uploadData` de PowerSync queda inerte hasta activar el servicio y definir push CRUD granular.
- Offline: las fotos seleccionadas se copian al directorio de la app antes de encolarse, para que el picker del sistema no invalide la URI mientras el telefono esta sin internet.
