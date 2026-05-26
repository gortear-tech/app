# NOTAS galeria - Fase 3

- Decision: la publicacion con foto ahora usa dos pasos: primero sube el asset a la pagina como foto no publicada (`published=false`) y guarda el `fb_photo_id` por `(asset, pagina)`; despues crea el post en `/feed` con `attached_media[0]`.
- Reuso: si `media_asset_fb_uploads` ya contiene un `fb_photo_id`, no se vuelve a subir la foto a Facebook. Solo se actualiza `last_used_at` y se crea el post con ese id.
- Registro de uso: cada publicacion confirmada inserta `media_asset_usages` y actualiza `media_assets.usage_count` / `last_used_at`.
- Rate limits: las llamadas a Graph usan `p-retry` con backoff exponencial y leen `Retry-After` / `X-Business-Use-Case-Usage` cuando Meta indica tiempo de recuperacion.
- Debug: `scheduled_posts` ahora conserva `fb_photo_id` y `fb_photo_reused` para que calendario/API muestren si el asset fue nuevo o reutilizado.
- Incierto: la documentacion publica de Meta sobre algunas paginas requiere login. El flujo implementado conserva el patron de Graph vigente usado por Pages API: foto no publicada + `attached_media` en feed.
