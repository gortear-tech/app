# Fase 4 - Web sincronizada

Decision [CODEX DECIDE]: se creo `apps/web` con Vite + React en vez de Next.js. La web es una herramienta interna de galeria/seleccion, no necesita SSR y Vite mantiene el despliegue como estatico simple en Render o Netlify.

PowerSync queda integrado como capa opcional mediante `VITE_POWERSYNC_URL`. Si no hay instancia configurada, la web sigue funcionando por REST contra la API existente. Esto conserva el comportamiento actual y evita bloquear el desarrollo por infraestructura externa.

La web usa los mismos contratos de `packages/shared`, los mismos endpoints de galeria (`/media/assets`, `/media/categories`, `/media/selections`) y el mismo JWT Supabase/API que el movil. Las escrituras de seleccion y metadata siguen pasando por API para respetar permisos y auditoria del backend.

Variables publicas nuevas:

- `VITE_API_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` o `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_POWERSYNC_URL`
- `VITE_SENTRY_DSN_WEB`

TODO(galeria): cuando PowerSync Cloud quede configurado en infraestructura, reemplazar las lecturas REST por watchers de `PowerSyncDatabase.watch` para tener reflejo subsegundo sin refrescar manualmente.
