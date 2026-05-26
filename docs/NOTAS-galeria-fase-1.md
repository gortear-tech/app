# Notas de implementacion - Galeria Fase 1

- El documento de diseno nuevo pide `uuid` nativo para todos los identificadores. El esquema existente de Maniaco usa columnas `text` con `gen_random_uuid()::text` en `workspaces`, `businesses`, `media_assets`, `variants` y `scheduled_posts`. Para no romper FKs ni el DataStore actual, las tablas nuevas de galeria usan `text` con el mismo patron existente.
- No se agregaron archivos `down.sql` porque el runner actual (`scripts/db-migrate.mjs`) aplica todo archivo `NNNN_*.sql` y no tiene convencion de rollback separada. Las migraciones nuevas son idempotentes con `if not exists` y preservan datos existentes.
- `FB_TOKEN_KEK` activa cifrado pgcrypto AES-256 para nuevos tokens de pagina. Si falta, el sistema mantiene compatibilidad legacy para no dejar sin publicar instalaciones existentes; al configurar la KEK, las siguientes reconexiones de Meta guardan ciphertext real.
