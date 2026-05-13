# Modulo 8 - Operacion, despliegue y reconstruccion
### Como correr FBmaniaco sin depender de una PC

## Principio

La app instalada en el celular debe hablar con una API publica. No debe usar `localhost`, IP local ni servicios que dependan de que la PC este prendida.

Principio operativo:

- Produccion debe poder sobrevivir reinicios de API/worker sin perder jobs ni duplicar publicaciones.
- Los ambientes deben estar separados: desarrollo, staging y produccion.
- Toda migracion de DB debe poder verificarse antes de exponer trafico productivo.
- Todo deploy debe tener rollback claro: backend, worker, APK/OTA y config.
- DB y Storage tienen estrategias de recuperacion distintas; restaurar Postgres no restaura objetos borrados de Storage.
- El sistema debe preferir degradacion segura antes que automatizar acciones riesgosas: pausar publicaciones, bloquear IA costosa, mantener `estado_incierto` y pedir accion humana.

## Repositorio

Estructura:

```text
apps/
  api/
  mobile/
  worker/
packages/
  shared/
  providers/
  domain/        opcional: servicios internos compartidos
supabase/
  migrations/
render.yaml
Dockerfile
```

Comandos base:

```powershell
pnpm install
pnpm typecheck
pnpm --filter @fbmaniaco/api dev
pnpm --filter @fbmaniaco/mobile build:android:production
```

Notas:

- `test`, `lint` y `build` existen en root pero actualmente no ejecutan tareas si los paquetes no definen esos scripts.
- La validacion real actual es `pnpm typecheck`.

## Desarrollo local

API:

```powershell
pnpm --filter @fbmaniaco/api dev
```

La app local puede usar:

- `http://localhost:4101` en emulador adecuado;
- IP LAN de PC para telefono fisico;
- pero produccion siempre debe usar HTTPS publico.

## Produccion API en Render

`render.yaml` define:

- servicio web;
- nombre `fbmaniaco-api`;
- runtime docker;
- plan free solo para demo o pruebas;
- health check `/health`;
- variables de entorno.

Produccion no debe depender de plan free. La API publica puede vivir como web service en Render, pero los trabajos de IA, media, publicacion, reintentos y metricas deben correr en un Render Background Worker continuo. Las tareas largas no deben bloquear requests HTTP.

Servicios minimos por ambiente:

| Ambiente | API | Worker | DB/Storage | Uso |
| --- | --- | --- | --- | --- |
| `development` | local o Render dev | local opcional | Supabase local/dev | Desarrollo y mocks. |
| `staging` | Render web service | Render background worker | Supabase staging | QA, App Review, pruebas Meta/OpenAI reales controladas. |
| `production` | Render web service pago | Render background worker pago | Supabase production con backups | Usuarios reales. |

Reglas:

- Staging y produccion no comparten DB, Storage, buckets, tokens Meta, OpenAI API key ni webhooks.
- Staging puede usar paginas Meta de prueba/testers y datos sintéticos.
- Produccion solo se despliega desde branch/tag aprobado.
- Preview environments de Render pueden usarse para PRs cuando el costo lo permita, pero no reemplazan staging.
- Worker debe ser servicio separado del web service; no correr jobs largos dentro de requests HTTP.

Pasos:

1. Subir repo a GitHub.
2. Crear Blueprint en Render desde repo.
3. Render detecta `render.yaml`.
4. Configurar secretos.
5. Esperar deploy.
6. Probar:

```text
https://fbmaniaco-api.onrender.com/health
```

Debe responder:

```json
{"ok":true}
```

### Health checks

`/health` debe separar:

- `liveness`: proceso API responde.
- `readiness`: DB, config minima y dependencias criticas estan listas.

Respuesta conceptual:

```json
{
  "ok": true,
  "service": "api",
  "environment": "production",
  "release": "2026.05.11-1",
  "checks": {
    "db": "ok",
    "storage": "ok",
    "queue": "ok",
    "config": "ok"
  }
}
```

Reglas:

- Render puede usar `/health` simple para reinicio automatico.
- Crear tambien `/ready` si se necesita distinguir proceso vivo de dependencias listas.
- Health publico no revela secretos, versiones completas de proveedores ni datos de clientes.
- Worker debe tener heartbeat en DB, no endpoint publico obligatorio.
- Si worker no late en el intervalo configurado, crear alerta y pausar nuevas publicaciones automaticas si hay riesgo.

## Supabase

Servicios:

- Supabase Auth para usuario/sesion de FBmaniaco.
- Supabase Postgres como fuente primaria.
- Supabase Storage para media.
- Supabase Queues/PGMQ como cola preferida.
- Supabase Cron para mantenimiento periodico.

Buckets:

- `fbmaniaco-media`: imagenes subidas y generadas.
- `fbmaniaco-backups`: respaldo opcional privado.

Requisitos:

- Postgres/Supabase DB como fuente primaria.
- service role en API.
- bucket media con URLs publicas o firmadas que puedan leer OpenAI y Meta.
- migrations para tablas primarias: users, workspaces, workspace_members, billing_accounts/entitlements, billing_provider_events, audit_logs, privacy_requests, upload_intents, media_assets, pages, businesses, batches, photos, variants, scheduled_posts, jobs, job_attempts, external_operations, idempotency_records, outbox_events, events, metric_definitions, post_metric_snapshots, performance_summaries, pricing_rules, usage_meters y cost_ledger.
- tablas `jobs`, `job_attempts` y `external_operations` listas antes de activar IA/publicacion.
- tabla `outbox_events` lista antes de activar workers/notificaciones.
- Si Supabase Queues/PGMQ esta disponible, crear colas `fbmaniaco_ia` y `fbmaniaco_publish`.
- Si Supabase Cron esta disponible, crear jobs de limpieza/reencolado/reportes, no un cron por cada publicacion.

### Backups y recuperacion

Supabase hace backups de DB segun plan, pero esos backups no restauran objetos de Storage borrados despues. Por eso el plan de recuperacion debe cubrir DB y objetos.

Politica recomendada:

| Recurso | Backup minimo | Produccion recomendada | Nota |
| --- | --- | --- | --- |
| Postgres | backup diario del plan | PITR si ya hay clientes reales | Define RPO real. |
| Storage originales/generados | retencion por bucket + lifecycle | copia/export privado de media critica publicada | DB backup solo contiene metadata. |
| Migraciones | git + CI | tags por release | Restaurar DB sin migraciones correctas rompe app. |
| Config/secrets | gestor de secretos | checklist de rotacion | Nunca backup en repo. |

Objetivos iniciales:

- Piloto controlado: RPO 24h, RTO 4h.
- Produccion comercial: RPO <= 1h para DB critica o PITR; RTO objetivo <= 2h para API/worker.
- Publicaciones en `estado_incierto`: RTO operativo 30 minutos, porque pueden duplicarse si se reintentan mal.

Runbook de restore:

1. Pausar workers y cron de produccion.
2. Bloquear acciones de publicacion/generacion costosa con feature flag.
3. Identificar punto de restauracion y posible perdida de datos.
4. Restaurar DB en proyecto nuevo o mismo proyecto segun severidad.
5. Verificar migraciones, RLS, indices, secrets y buckets.
6. Reconciliar Storage: objetos referenciados por `media_assets` deben existir.
7. Reconciliar `scheduled_posts` y `external_operations` antes de reactivar `publish_post`.
8. Reanudar API en modo lectura si aplica.
9. Reanudar workers gradualmente.
10. Registrar incidente y postmortem.

## OpenAI

Variables:

- `OPENAI_API_KEY`
- `OPENAI_VISION_MODEL`
- `OPENAI_IMAGE_MODEL`
- `OPENAI_IMAGE_FALLBACK_MODEL`
- `OPENAI_IMAGE_SIZE`
- `OPENAI_IMAGE_TIMEOUT_MS`
- `OPENAI_CAPTION_MODEL`
- `OPENAI_BATCH_ENABLED`
- `OPENAI_FLEX_ENABLED`

Modelos recomendados de config:

- vision/caption interactivo: modelo Responses API configurable, preferentemente `gpt-5.4-mini` o modelo superior si la calidad lo justifica.
- imagen primaria: `gpt-image-2` cuando este disponible para la cuenta/proyecto.
- imagen fallback: `gpt-image-1.5` o `gpt-image-1-mini` segun calidad/costo.
- captions/reportes no urgentes: Batch o Flex solo si el usuario no espera resultado inmediato.

Regla:

- Si un modelo falla por disponibilidad/permisos, provider de imagen intenta fallback.
- Usar Structured Outputs para analisis de vision, captions, planes de generacion y ranking, evitando parsear texto libre.
- Usar prompt caching cuando haya contexto estable del negocio/estilo.
- No poner API key en codigo ni docs.

## Meta / Facebook

Variables:

- `META_APP_ID`
- `META_APP_SECRET`
- `META_BOOTSTRAP_TOKEN` opcional.
- `META_DEVICE_LOGIN_SCOPES`.
- `META_GRAPH_API_VERSION`.
- `META_APP_MODE`: `development` o `live`.
- `META_REQUIRED_SCOPES`.
- `META_OPTIONAL_SCOPES`.

Scopes actuales:

- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`

Scopes opcionales:

- `pages_manage_metadata` solo si se implementan webhooks/subscriptions.
- `business_management` solo si Login for Business/Business Manager lo requiere y se puede justificar en App Review.

Requisitos:

- paginas activas;
- page access token valido;
- permisos aprobados por Meta si aplica.
- flujo principal de produccion mediante Facebook Login/OAuth o Login for Business si aplica; device login solo si Meta lo soporta para la configuracion vigente.
- token manual disponible solo para desarrollo/soporte si una variable server-side lo habilita.
- App Review/Business Verification completados antes de operar con clientes externos que no sean roles de la app.
- screencast y cuenta de prueba listos para demostrar: login, seleccion de pagina, publicacion/programacion y reconexion.
- manejo de permisos granulares: si una pagina no fue marcada al autorizar, debe aparecer como no disponible o pedir reconexion.

## APK Android

Proyecto:

`apps/mobile`

Recomendaciones:

- Usar TanStack Query para lecturas remotas y mutaciones.
- Invalidar `home`, `batch`, `calendar`, `business`, `jobs` y `pages` despues de comandos relevantes.
- Guardar sesion local en Expo SecureStore.
- No guardar page access tokens de Meta en el celular.

Build profile:

`production`

Env:

- `APP_VARIANT=production`
- `API_URL=https://fbmaniaco-api.onrender.com`

Comando:

```powershell
cd apps/mobile
pnpm dlx eas-cli build -p android --profile production --non-interactive
```

O desde root:

```powershell
pnpm --filter @fbmaniaco/mobile build:android:production
```

Nota:

- Como existe carpeta nativa Android, `versionCode` y `versionName` reales salen de `apps/mobile/android/app/build.gradle`.
- `app.config.ts` tambien debe mantenerse sincronizado.
- Si no se sube `versionCode`, Android puede rechazar instalar encima.

## Versionado Android

Archivos a sincronizar:

- `apps/mobile/app.config.ts`
- `apps/mobile/android/app/build.gradle`

Campos:

- version visible: `0.1.x`.
- versionCode incremental: entero.

Regla:

- cualquier cambio visible en app movil requiere APK nuevo.
- cambio solo backend no requiere APK, salvo que cambie contrato incompatible.

### EAS Update / OTA

Si se activa EAS Update:

- usar canales separados: `staging` y `production`;
- vincular cada build a `runtimeVersion`;
- solo publicar OTA compatible con el mismo runtime nativo;
- cambios nativos, permisos, dependencias nativas, iconos, package name o config Android requieren build nuevo;
- OTA productivo debe tener rollback: publicar update correctivo o volver al embedded update compatible.

Reglas:

- No usar OTA para cambiar endpoints incompatibles con el backend desplegado.
- No mezclar testers y produccion en el mismo canal.
- Registrar `release`, `runtimeVersion`, `channel`, `branch` y `updateId` en Sentry/logs.

## Checklist de deploy seguro

1. `git status --short` limpio o entender cambios.
2. Confirmar ambiente objetivo: staging o production.
3. Revisar migraciones DB y compatibilidad hacia atras.
4. `pnpm typecheck`.
5. Ejecutar tests unitarios/smoke disponibles.
6. Aplicar migraciones primero en staging.
7. Probar flujo critico en staging: login, pagina, lote, generar mock/real controlado, calendario, publish mock/test.
8. Crear tag/release.
9. Push a GitHub.
10. Trigger Render deploy.
11. Esperar status `live`.
12. Probar `/health` y `/ready`.
13. Probar dashboard de negocio real.
14. Verificar worker heartbeat y cola sin atraso.
15. Verificar Sentry/logs para la nueva release.
16. Si hubo app movil:
   - subir version;
   - build EAS;
   - obtener APK directo;
   - instalar en celular.

### Rollback

Backend/API:

- revertir a deploy anterior en Render;
- si hubo migracion incompatible, ejecutar migracion de rollback o restaurar desde backup solo como ultimo recurso;
- mantener contratos backwards-compatible siempre que sea posible para evitar rollback de APK.

Worker:

- pausar worker antes de rollback si hay jobs de publicacion/IA en curso;
- revisar `job_attempts` y `external_operations`;
- no reactivar hasta reconciliar operaciones ambiguas.

Mobile:

- si es OTA compatible, publicar update correctivo o rollback a embedded compatible;
- si es build nativo, subir `versionCode` nuevo con fix;
- nunca bajar `versionCode`.

Config/secrets:

- cambios de variable se tratan como release;
- mantener snapshot seguro de nombres/valores esperados sin revelar secretos;
- si se filtra secreto, rotar y revocar, no solo borrar logs.

## Diagnostico comun

### No puedo entrar a la app

Revisar:

- API publica responde `/health`.
- APK apunta a Render, no localhost.
- token de Meta valido.
- bootstrap-status devuelve siguiente paso correcto.

### Dice publicaciones pausadas

Revisar:

- tokenStatus del negocio.
- pageAccessTokenStatus.
- scheduled posts `pausada_por_token`.
- Meta Graph error.

### Lotes cancelados siguen apareciendo

Debe verificarse:

- `cancelBatch` persiste estado.
- `listBatches` filtra cancelado/abandonado.
- `activeBatch` no considera cancelado/fallido/abandonado.
- acciones sobre batch cerrado devuelven 409.

### Variantes parecidas

Revisar:

- estilo se asigna por variante, no foto.
- penalizacion por estilo usado en misma foto.
- prompt contiene direccion creativa.
- caption recibe avoidCaptions.
- imagen se genera una por una, no lote grande indistinto.

### Imagen se recorta en aprobacion

UI debe usar:

- `resizeMode="contain"`.
- imagen cuadrada generada.
- frame estable.

### Worker no publica a tiempo

Revisar:

- heartbeat del worker.
- cola `fbmaniaco_publish`.
- jobs `publish_post` con `runAfter <= now`.
- `leaseExpiresAt` vencidos.
- `scheduled_posts` pasados fuera de ventana de tolerancia.
- errores Meta/token.

Accion segura:

- no publicar atrasados en masa;
- marcar `needs_user_action` o `fallida` si la ventana expiro;
- reconciliar cualquier `provider_started` antes de reintentar.

### DB restaurada pero faltan imagenes

Revisar:

- `media_assets` apunta a objetos existentes.
- bucket correcto por ambiente.
- objetos publishable existen para posts pendientes.

Accion:

- si falta original/generado no publicado, marcar entidad como no recuperable o pedir nueva foto;
- si falta media de post futuro, pausar publicacion;
- no usar URLs rotas hacia Meta.

## Reconstruccion desde cero

Orden recomendado:

1. Crear monorepo pnpm.
2. Crear `packages/shared` con estados, schemas TypeBox/JSON Schema y contratos de respuestas.
3. Crear migraciones Supabase/Postgres: usuarios, workspaces, workspace_members, billing/entitlements, billing_provider_events, audit_logs, privacy_requests, upload_intents, media_assets, paginas, capacidades Meta, negocios, lotes, fotos, variantes, posts, jobs, job_attempts, external_operations, idempotencia, eventos, metric_definitions, post_metric_snapshots, performance_summaries, pricing, usage_meters, costos y outbox.
4. Activar Supabase Auth y definir como la API valida usuario/sesion.
5. Crear API Fastify con health, auth/bootstrap, comandos, lecturas y OpenAPI generado.
6. Crear Supabase Storage/media y reglas de URLs publicas/firmadas.
7. Crear tabla `jobs`, outbox y cola Supabase Queues/PGMQ.
8. Crear worker continuo con reclamo idempotente y dedupe.
9. Crear `packages/providers` con interfaces, mocks y adaptadores Meta/OpenAI/Supabase.
10. Crear servicios internos de IA: decisiones, memoria, estilos, captions, ranking y reportes.
11. Agregar OpenAI vision/image/caption con Structured Outputs y fallback de modelos.
12. Agregar Meta auth/publish con page tokens server-only.
13. Crear Expo app con Supabase Auth/sesion ligera, TanStack Query y SecureStore.
14. Crear flujo paginas -> home con query keys e invalidaciones.
15. Crear flujo de lote con jobs.
16. Crear calendario con jobs de publicacion.
17. Crear configuracion, SEO y estilos.
18. Agregar Sentry, tracing, logs estructurados y metricas de jobs.
19. Agregar Vitest para servicios/jobs y Maestro para E2E movil.
20. Crear deploy Render web service + background worker.
21. Crear APK production.

## Seguridad

- Nunca commitear `.env`.
- Nunca commitear backups/exportaciones con tokens.
- Nunca imprimir tokens en logs finales.
- Tokens de Meta y service role solo en variables de entorno.
- Tokens Meta persistidos cifrados con `TOKEN_ENCRYPTION_KEY` o mecanismo server-only equivalente.
- Buckets separados: originales privados, generados privados, media publicable controlada.
- Backups/snapshots opcionales no deben contener data URLs gigantes si se puede evitar.
- Las imagenes publicas deben estar pensadas para Facebook/OpenAI, no para datos privados.

## Feature flags y kill switches

Config server-side obligatoria:

- `FEATURE_OPENAI_IMAGE_GENERATION`.
- `FEATURE_META_PUBLISH`.
- `FEATURE_REMOTE_SCHEDULE`.
- `FEATURE_AUTONOMOUS_PUBLISH`.
- `FEATURE_BATCH_EVALS`.
- `MAINTENANCE_MODE`.

Reglas:

- Flags viven en backend/config segura, no hardcodeadas en la app.
- `MAINTENANCE_MODE` permite lecturas basicas y bloquea mutaciones riesgosas.
- Si hay incidente Meta, apagar `FEATURE_META_PUBLISH` y dejar calendario editable localmente.
- Si hay incidente OpenAI/costos, apagar generacion y mantener aprobacion/calendario de contenido ya generado.
- Si hay jobs ambiguos, apagar automatismos antes de reintentar.

## Comunicacion operativa

Produccion debe respetar el mismo contrato entre modulos:

- APK apunta solo a `API_URL`/`EXPO_PUBLIC_API_URL` HTTPS publico.
- API en Render coordina DB, jobs, providers, Storage y worker.
- Supabase/Postgres es fuente primaria; Storage guarda media y respaldos opcionales.
- Worker usa los mismos estados, `dedupeKey` y reglas anti-duplicado que la API.
- Worker usa Supabase Queues/PGMQ si esta disponible; si no, reclama jobs con bloqueo de fila y evita jobs ya bloqueados por otros workers.
- Worker corre como servicio continuo, no como request HTTP ni proceso local de PC.
- Supabase Cron encola mantenimientos y reportes periodicos.
- Jobs y outbox events se crean en la misma transaccion que la mutacion de negocio.
- Cambios de variables o version de API que alteren contratos deben exigir nuevo build movil solo si cambian rutas/respuestas que la app consume.

Checklist de comunicacion antes de publicar:

- `/auth/bootstrap-status` resuelve pantalla inicial.
- La API valida sesion FBmaniaco antes de comandos de negocio.
- `/businesses/:businessId/dashboard` resume Home sin pedir tablas completas.
- `/businesses/:businessId/scheduled-posts` alimenta calendario sin secretos.
- Mutaciones criticas persisten en DB antes de responder exito.
- Cada mutacion devuelve `changed` o `invalidate` para que la app refresque solo queries afectadas.
- Jobs activos pueden consultarse sin exponer payloads internos.
- Outbox no contiene secretos ni base64.
- Errores de Meta/OpenAI/Supabase llegan a UI como `userMessage`, no como payload crudo.
- Sentry captura errores de app movil, API y worker con `release`, `environment`, `requestId`, `traceId`, `userId`, `workspaceId`, `batchId` y `jobId` cuando aplique.

## Pendientes obligatorios antes de operar comercialmente

- Renovacion automatica robusta de tokens.
- Telemetria de costos por proveedor/modelo.
- Sentry, tracing y logs estructurados por request/job/proveedor.
- Alertas operativas para jobs atorados, publicaciones inciertas, webhooks fallidos, error rate y costo/latencia fuera de presupuesto.
- Contratos JSON Schema/TypeBox y OpenAPI generado.
- Tests unitarios para servicios internos de IA y jobs.
- E2E movil para flujo lote.
- Staging separado de produccion.
- Backups DB verificados y plan Storage definido.
- Runbook de restore probado al menos una vez.
- Kill switches operativos para Meta/OpenAI/autonomia.
- Rollback documentado para API, worker y APK/OTA.

## Mejoras posteriores

- Panel de debug seguro sin exponer secretos.
- Preview environments por PR cuando el costo operativo lo justifique.
- Terraform/IaC solo si crecen ambientes/equipo.


