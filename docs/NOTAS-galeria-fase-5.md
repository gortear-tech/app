# NOTAS - Galeria offline-first Fase 5

## Decisiones

- Se implemento `menu:parse` con proveedor OpenAI Responses y fallback local. La entrada acepta texto, imagen o PDF; para PDF/archivo se usa `input_file` con Base64 y para imagen `input_image` con data URL, siguiendo documentacion oficial actual de OpenAI.
- Para casi duplicados se eligio dHash de 64 bits guardado en `media_assets.phash`. Es determinista, barato y suficiente para advertencias iniciales; no bloquea subidas.
- La categorizacion automatica tras importar menu solo asigna categoria a assets listos sin categoria cuando el nombre/ruta coincide con keywords del item. No modifica assets ya categorizados.
- La UI de importacion de menu quedo en ajustes por pagina en movil y en la barra lateral web. Por ahora la importacion de archivo PDF/imagen queda disponible por API/worker, pero la UI expone texto pegado para evitar permisos extra de archivos en esta fase.

## Referencias verificadas

- OpenAI file inputs: `input_file` acepta Base64, file ID o URL externa en Responses API.
- OpenAI vision/images input: `input_image` acepta URL o data URL Base64 en Responses API.
