# Modulo 7 - API, comandos, lecturas, jobs y datos
### Backend Fastify + DB primaria + workers

## Principio

La API es el centro de coordinacion. Debe ser publica, estable, recuperable tras reinicios y no depender de la PC local. La fuente primaria de verdad vive en Postgres/Supabase DB. El runtime en memoria, si existe, es cache operativo y nunca debe ser la unica verdad.

## Contrato de comunicacion API

La API es el unico punto de comunicacion entre la app movil y el resto del sistema. Debe hablar con cada modulo usando contratos pequenos y predecibles:

- Home consume `dashboard` y `scheduled-posts` resumidos.
- Lotes consume detalle de batch, fotos, variantes y jobs relacionados.
- Calendario consume scheduled posts normalizados por `business.timezone`.
- Configuracion consume business detail y catalogo de estilos.
- Servicios internos de IA consumen contexto armado por API/worker, nunca requests crudos de UI.
- Providers reciben comandos especificos y devuelven resultados normalizados.
- Workers ejecutan jobs lentos o costosos.
- Supabase Queues/PGMQ puede usarse como cola fisica para simplificar el reclamo de jobs.

Cada mutacion debe responder con:

- entidad cambiada o summary actualizado;
- `jobId` si la accion queda asincrona;
- `changed` con IDs o campos afectados cuando aplique;
- `nextStep` si la UI debe moverse de pantalla;
- `alerts` si la accion crea o resuelve problemas visibles.

Envelope canonico de mutacion:

```ts
type MutationResponse<T> = {
  schemaVersion: "mutation_response.v1";
  ok: true;
  data: T;
  changed: {
    entities: Array<{ type: string; id: string }>;
    queryKeys: string[];
  };
  jobId?: string;
  nextStep?: string;
  alerts?: BusinessAlert[];
  requestId: string;
};
```

Reglas:

- Toda mutacion costosa o con side effect externo debe aceptar header `Idempotency-Key`.
- La API debe persistir la idempotencia por `workspaceId`, `actorId`, ruta, metodo e idempotency key.
- Si el cliente repite la misma mutacion con la misma key, la API devuelve la respuesta ya confirmada o el job existente.
- El `requestId` viaja a logs, jobs y eventos para trazabilidad.
- Si la app envia `X-Request-Id`, la API puede aceptarlo solo si tiene formato valido; si no, genera uno nuevo.
- La API debe devolver `requestId` en toda respuesta exitosa o de error.
- Las respuestas de mutacion y DTOs compartidos evolucionables deben incluir `schemaVersion`.
- Todo comando valida rol del `actorId` en `workspace_members`; no basta con que el `businessId` exista.

La API no debe obligar a la app a inferir transiciones complejas. Si una accion cambia de `pendiente_confirmacion` a `confirmado`, o crea un job `generate_batch`, la respuesta debe dejarlo explicito.

## App API

Ruta:

`apps/api/src/app.ts`

Framework:

- Fastify.
- CORS habilitado.
- bodyLimit configurable por `MAX_UPLOAD_BODY_MB`.

Contratos:

- JSON Schema como contrato runtime de entrada/salida.
- TypeBox recomendado para derivar tipos TypeScript desde schemas sin duplicar reglas.
- OpenAPI generado desde las rutas Fastify para que la app movil, QA y reconstruccion usen la misma verdad.
- Validacion de `body`, `params`, `query` y `headers` en rutas que cambian estado.
- Serializacion de respuestas con schema para no filtrar campos internos.
- Schemas versionados: cada contrato compartido que pueda evolucionar debe incluir `schemaVersion` o versionarse en `packages/shared`.
- Los nombres canonicos en API usan `camelCase`; DB usa `snake_case`; aliases legacy como `negocioId` no se usan en contratos nuevos.
- En OpenAPI, documentar headers `Authorization`, `Idempotency-Key` y `X-Request-Id` donde apliquen.

Error handler:

- si error es `AppError`, responde:
  - `code`;
  - `message`;
  - `userMessage`;
  - `details`.
- si payload demasiado grande, responde `payload_too_large`.
- otros errores: `internal_error`.

## DB primaria

Fuente primaria:

- Supabase Postgres o Postgres administrado.

Debe guardar:

- users;
- workspaces;
- workspace entitlements/billing_accounts o columnas equivalentes;
- facebook_pages;
- meta tokens cifrados o referencias server-only;
- chequeo de rol por workspace antes de cualquier mutacion;
- businesses;
- visual_styles;
- batches;
- photos;
- variants;
- scheduled_posts;
- jobs;
- idempotency_records;
- outbox_events;
- events;
- autonomy_state;
- metric_definitions;
- post_metric_snapshots;
- performance_summaries;

Reglas:

- Toda mutacion critica se confirma en DB antes de responder exito.
- Toda lectura de pantalla sale de queries o views sanitizadas.
- Tokens se guardan cifrados o en almacenamiento server-only restringido.
- El cache en memoria puede acelerar lecturas, pero debe poder reconstruirse desde DB.
- Toda mutacion costosa valida plan, `billingStatus` y entitlements antes de crear jobs o tocar proveedores.

## Runtime/cache

Ruta posible:

`apps/api/src/cache.ts`

Uso permitido:

- cache de negocios, estilos y configuracion;
- summaries de dashboard por pocos segundos;
- jobs en progreso;
- mapas por ID reconstruibles desde DB.

No debe:

- ser fuente primaria;
- contener la unica copia de tokens;
- responder exito si la DB no confirmo la mutacion.

## Persistencia y Storage

DB:

- `DATABASE_URL` o Supabase connection string.
- migraciones versionadas.
- indices por `workspaceId`, `businessId`, `batchId`, `status`, `scheduledFor` en API / `scheduled_at` en DB y `dedupeKey`.
- cifrado obligatorio o almacenamiento server-only equivalente para tokens Meta/user/page tokens.
- tablas de pricing/versionado para estimaciones de costo, costos reales por proveedor/modelo y limites comerciales por workspace.
- `usage_meters` para reservas/consumo del periodo; los limites no se calculan solo sumando eventos historicos en cada request.

Media:

- bucket `SUPABASE_MEDIA_BUCKET`, default `fbmaniaco-media`.
- imagenes originales y generadas.
- URLs publicas/controladas para Meta y app.

Snapshot/cache opcional:

- bucket `SUPABASE_STATE_BUCKET`, default `fbmaniaco-backups`.
- objeto `SUPABASE_STATE_OBJECT`, default `backup-state.json`.
- sirve para diagnostico o respaldo secundario, no como fuente primaria.

Flujo de arranque:

1. Verifica conexion a DB.
2. Carga cache minima desde DB.
3. Reclama o desbloquea jobs `running` vencidos.
4. Normaliza scheduled posts inciertos.
5. Expone `/health` solo si DB y config minima estan listas.

## Jobs

Tabla:

`jobs`

Campos minimos:

- `id`
- `type`
- `status`
- `workspaceId`
- `businessId`
- `batchId`
- `photoId`
- `variantId`
- `scheduledPostId`
- `dedupeKey`
- `payload`
- `result`
- `attempts`
- `maxAttempts`
- `runAfter`
- `lockedAt`
- `lockedBy`
- `operationKey`
- `leaseExpiresAt`
- `nextRetryAt`
- `lastAttemptId`
- `lastError`
- `createdAt`
- `updatedAt`

Tipos:

- `analyze_photo`
- `generate_batch`
- `generate_variant`
- `schedule_posts`
- `publish_post`
- `retry_post`
- `sync_remote_post`
- `cancel_remote_post`
- `reconcile_external_operation`
- `collect_metrics`
- `weekly_report`
- `batch_caption_eval`

Estados:

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`
- `blocked`
- `needs_user_action`

Reglas:

- API crea jobs dentro de una transaccion.
- Worker reclama jobs preferentemente desde Supabase Queues/PGMQ usando mensajes con `jobId`.
- Si no hay PGMQ, worker reclama desde `jobs` por `status`, `runAfter` y lock usando `FOR UPDATE SKIP LOCKED`.
- Cada job debe ser idempotente.
- `dedupeKey` evita duplicados.
- `operationKey` evita repetir side effects externos.
- Cancelar lote cancela jobs pendientes relacionados.
- Jobs `running` vencidos pueden volver a `queued` solo si no hubo side effect externo iniciado.
- Si hubo side effect iniciado, el job pasa a reconciliacion y la entidad destino queda `estado_incierto`, `blocked` o `needs_user_action` segun riesgo.
- La reconciliacion se modela como job `reconcile_external_operation` con `dedupeKey = operationKey`, para auditarla y evitar varias verificaciones concurrentes.
- `publish_post` nunca publica si ya existe `facebookPostId`.
- `generate_variant` nunca llama OpenAI si la variante ya tiene `imageUrl` y caption valido.
- `schedule_posts` nunca crea dos scheduled posts para la misma variante aprobada.
- `retry_post` no crea un segundo post si existe `facebookPostId`, `remoteStatus = confirmado_meta` o `ExternalOperation` pendiente/ambigua.
- `sync_remote_post` solo lee Meta y actualiza estado con evidencia; no publica ni cancela.
- `cancel_remote_post` solo se crea si existe `facebookPostId` y la capacidad de pagina permite borrar/cancelar remoto.

## Cola PGMQ recomendada

Colas recomendadas:

- `fbmaniaco_ia`: vision, generacion, captions, reportes.
- `fbmaniaco_publish`: programacion, publicacion, reintentos, metricas.

Mensaje minimo:

```ts
type QueueMessage = {
  jobId: string;
  type: JobType;
  workspaceId: string;
  businessId?: string;
};
```

Reglas:

- El payload pesado vive en `jobs.payload`, no en la cola.
- La cola solo transporta `jobId` y datos minimos de enrutamiento.
- Al completar, worker actualiza `jobs`, `job_attempts` y `external_operations`; despues archiva/elimina mensaje.
- Si el worker cae, el visibility timeout permite reentrega.
- Aun con PGMQ, `dedupeKey` y checks de entidad siguen siendo obligatorios.
- No usar `pop` para trabajos criticos porque borra al leer; preferir read/visibility timeout + archive/delete despues de persistir resultado.

Fallback con tabla `jobs`:

```sql
select id
from jobs
where status = 'queued'
  and run_after <= now()
order by run_after asc, created_at asc
for update skip locked
limit 1;
```

El worker debe marcar el job `running` en la misma transaccion en la que lo reclama.

Patron recomendado para tabla `jobs`:

- `UPDATE ... WHERE id in (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *` para reclamar y marcar en un solo statement.
- Asignar `lockedAt`, `lockedBy` y `leaseExpiresAt`.
- Renovar lease solo si el worker sigue vivo y no esta bloqueado en una llamada externa sin timeout.
- Si `leaseExpiresAt` vence, otro worker no debe ejecutar side effects sin revisar `job_attempts` y `external_operations`.

## Reconciliacion de side effects

Todo proveedor externo se trata como "al menos una vez". La exactitud real se logra con DB + checks + reconciliacion.

Reglas:

- Antes de llamar proveedor, crear `JobAttempt` y `ExternalOperation` en `started`.
- Cada llamada a proveedor debe registrar span/log con `requestId`, `traceId`, `jobId`, `operationKey`, proveedor, operacion, modelo/version, duracion, status y usage/costo sanitizado.
- Si el proveedor devuelve ID externo, persistirlo en la entidad destino antes de cerrar el job.
- Si hay timeout/desconexion tras iniciar proveedor, marcar intento/operacion como `ambiguous`.
- Jobs ambiguos no se reintentan automaticamente si pueden duplicar posts o costos altos.
- `publish_post` ambiguo consulta Meta antes de publicar otra vez.
- `generate_variant` ambiguo revisa si existe `imageUrl`/asset guardado; si no existe, puede reintentar solo registrando costo potencial y manteniendo dedupe.
- `cost_ledger` debe tener unicidad por `operationKey + entryType` cuando exista; si no aplica, usar una clave unica equivalente por `jobId + operation + priceVersion + entryType`.

## Outbox transaccional

Tabla recomendada:

`outbox_events`

Uso:

- entrega confiable de eventos internos;
- auditoria desacoplada;
- notificaciones futuras;
- sincronizacion con colas externas si algun dia se usa Redis/BullMQ/SQS.

Campos minimos:

- `id`
- `eventType`
- `aggregateType`
- `aggregateId`
- `workspaceId`
- `businessId`
- `payload`
- `status`
- `availableAt`
- `processedAt`
- `attempts`
- `lastError`
- `createdAt`

Reglas:

- Comando que cambia estado escribe evento outbox en la misma transaccion.
- Worker procesa solo eventos confirmados.
- Si se usa cola externa, el outbox es el puente confiable entre DB y cola.
- Si se usa PGMQ, outbox puede insertar/solicitar mensaje en la cola despues de confirmar la transaccion.
- Payload no debe contener secretos ni base64.

## Comandos y lecturas

Separacion recomendada:

- Comandos: endpoints que cambian estado y pueden crear jobs/outbox events.
- Lecturas: endpoints que devuelven summaries/details sanitizados.

Reglas:

- Un comando nunca devuelve tablas completas ni cache interno.
- Una lectura nunca ejecuta efectos externos.
- Si un comando es asincrono, devuelve `jobId` y estado inicial.
- La app consulta progreso con detalle de batch, dashboard o endpoint de job.
- Opcionalmente, API/worker puede emitir progreso por Realtime/Broadcast, pero la app siempre debe poder recuperarlo por lectura HTTP.

## Endpoints completos

### Salud

`GET /health`

Respuesta:

`{ ok: true }`

### Auth / Meta

`GET /auth/bootstrap-status`

- Lectura. Decide pantalla inicial.

`POST /auth/meta/connect`

- Comando. Inicia o continua autorizacion oficial de Meta mediante Facebook Login/OAuth, Login for Business si aplica, o device login solo si esta soportado para la configuracion vigente.

`POST /auth/meta/callback`

- Comando server-side. Completa el intercambio de OAuth/device login, calcula scopes/paginas concedidas, crea/actualiza `MetaAuthorization` y guarda credenciales tecnicas en backend.

`POST /auth/meta/refresh`

- Comando. Intenta refrescar credenciales tecnicas server-side y actualizar paginas/status.

`POST /auth/meta-token/support`

- Comando restringido. Procesa token manual solo en desarrollo/soporte controlado.

`POST /auth/logout`

- Comando. Salida local.

`GET /me`

- Lectura. Sesion local owner/usuario actual.

### Paginas

`GET /meta/pages`

- Lectura. Lista paginas sin page access token, indicando si fueron concedidas por permisos granulares y si tienen permisos suficientes para publicar.

`POST /meta/pages/select`

- Comando. Selecciona pagina y crea/reutiliza negocio solo si pertenece al workspace, fue concedida por Meta y tiene permisos suficientes.

### Estilos

`GET /styles`

`POST /styles`

`PATCH /styles/:styleId`

`DELETE /styles/:styleId`

### Negocios

`GET /businesses`

- Lectura. Lista negocios del workspace.

`POST /businesses`

- Comando. Si hay `pageId`, selecciona pagina. Si no, devuelve negocio seleccionado.

`GET /businesses/:businessId`

- Lectura. Detalle.

`PATCH /businesses/:businessId`

- Comando. Actualiza metadata, autonomia, nombre, industria, timezone.

`GET /businesses/:businessId/dashboard`

- Lectura agregada. Dashboard con alertas, lote activo, performance summary, weekly report y limites comerciales sanitizados si afectan acciones visibles.

`GET /businesses/:businessId/performance`

- Lectura. Devuelve summaries recalculables por rango, estilo, horario y tipo de contenido. Incluye `sampleSize`, `confidence` y `reasonCodes`; no devuelve payloads crudos de Meta.

`GET /businesses/:businessId/reports/weekly`

- Lectura. Devuelve ultimo reporte semanal generado o summary vacio si no hay muestra suficiente.

### Lotes

`POST /businesses/:businessId/batches`

- Comando. Crea lote `pending_upload`.

`POST /businesses/:businessId/batches/:batchId/cancel`

- Comando. Cancela lote, jobs pendientes y elementos no publicados.

`GET /businesses/:businessId/batches`

- Lectura. Lista lotes no cancelados/abandonados.

`GET /businesses/:businessId/batches/active`

- Lectura. Devuelve lote activo.

`GET /businesses/:businessId/batches/:batchId`

- Lectura. Detalle con fotos, variantes y jobs relevantes.

### Fotos

`POST /businesses/:businessId/batches/:batchId/photos/upload-intent`

- Comando. Crea `UploadIntent` y devuelve signed upload info para subida directa binaria a Storage privado. No persiste `uploadUrl`.

`POST /businesses/:businessId/batches/:batchId/photos/complete-upload`

- Comando. Recibe `storageKey`, metadata de archivo y checksum opcional. Verifica objeto, intent, MIME/tamano/hash, crea `Photo`, `MediaAsset original` y job `analyze_photo`.
- `imageDataUrl` solo queda como fallback de desarrollo o emergencia, no como ruta principal de produccion.

### Costos y generacion

`POST /businesses/:businessId/batches/:batchId/estimate-cost`

- Lectura/calculo. No muta salvo cache opcional. Usa tabla server-side de precios por proveedor/modelo/version/dimensiones, no una constante fija. Valida entitlements, presupuesto IA mensual y credito incluido antes de devolver una estimacion confirmable.

`POST /businesses/:businessId/batches/:batchId/confirm-cost`

- Comando. Guarda costo confirmado, version de precio, desglose y actor que aprobo. Reserva cupo/costo en `usage_meters` y `cost_ledger` dentro de la misma transaccion. Si excede limite o presupuesto, no crea jobs.

`POST /businesses/:businessId/batches/:batchId/generate`

- Comando. Crea job `generate_batch` y jobs `generate_variant` solo si existe costo confirmado y reserva vigente.

### Variantes

`GET /businesses/:businessId/batches/:batchId/variants`

- Lectura.

`POST /businesses/:businessId/batches/:batchId/variants/reopen-approval`

- Comando.

`PATCH /businesses/:businessId/batches/:batchId/variants/:variantId/caption`

- Comando.

`POST /businesses/:businessId/batches/:batchId/variants/:variantId/approve`

- Comando.

`POST /businesses/:businessId/batches/:batchId/variants/:variantId/reject`

- Comando.

### Calendario

`POST /businesses/:businessId/batches/:batchId/calendar/confirm`

- Comando. Crea job `schedule_posts`.

`GET /businesses/:businessId/scheduled-posts`

- Lectura. Acepta rango (`from`, `to`) y devuelve `deliveryMode`, `remoteStatus`, `lastRemoteSyncAt`, warnings seguros y acciones disponibles.

`GET /businesses/:businessId/batches/:batchId/scheduled-posts`

- Lectura.

`PATCH /businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId`

- Comando. Cambia fecha/hora. Si `remoteStatus = no_enviado`, ajusta job local. Si `remoteStatus = confirmado_meta`, crea job de sync/update/cancel-recreate solo si la capacidad Meta lo permite; si no, queda `needs_user_action` o `estado_incierto` con razon clara.

`POST /businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId/cancel`

- Comando. Cancela post y jobs pendientes. Si nunca se envio a Meta, resuelve local. Si existe `facebookPostId`, crea `cancel_remote_post`; no responde como cancelado definitivo hasta confirmar Meta.

`POST /businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId/publish`

- Comando. Crea o adelanta job `publish_post` con `deliveryMode = publish_now`. Requiere que no exista `facebookPostId` ni operacion ambigua.

`POST /businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId/retry`

- Comando. Crea job `retry_post`.

`POST /businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId/sync`

- Comando. Crea job `sync_remote_post` para verificar estado en Meta si existe `facebookPostId` o una operacion ambigua.

`POST /businesses/:businessId/meta/publishing-capabilities/probe`

- Comando restringido a owner/admin/tester. Prueba capacidades de publicacion de la pagina conectada para la version Graph configurada y actualiza `meta_publishing_capabilities`.

### Jobs

`GET /jobs/:jobId`

- Lectura. Estado de job visible y sanitizado.

`GET /businesses/:businessId/jobs`

- Lectura. Jobs recientes o activos del negocio.

### Metricas y reportes

`POST /businesses/:businessId/metrics/collect`

- Comando interno/admin. Crea job `collect_metrics` para posts publicados dentro del rango. No se expone como accion normal del usuario.

`POST /businesses/:businessId/reports/weekly/generate`

- Comando interno/admin o accion manual de soporte. Crea job `weekly_report`.

`POST /jobs/:jobId/cancel`

- Comando. Cancela job si aun no tiene side effect irreversible.

## Contratos compartidos

Paquete:

`packages/shared`

Archivos:

- `states.ts`: enums/status.
- `business.ts`: negocio, dashboard, fotos, variantes.
- `batches.ts`: lote y requests upload.
- `media.ts`: upload intents, media assets, derivados, URLs publicables y validacion antes de Meta.
- `facebook.ts`: paginas, tokens sanitizados, Meta device login, publish data.
- `styles.ts`: estilos.
- `vision.ts`: schema de vision, assigned style, generation plan.
- `scheduling.ts`: scheduled post.
- `jobs.ts`: job types, statuses, progress.
- `idempotency.ts`: headers, records and reusable response rules.
- `metrics.ts`: metricas/performance.
- `errors.ts`: AppError.

## Eventos de dominio

Las mutaciones relevantes deben registrar eventos de dominio sanitizados:

- autorizacion Meta creada/actualizada, scopes actualizados y seleccion/conexion de pagina;
- cambios de negocio, SEO, autonomia y estilos;
- foto validada;
- job creado, completado, fallido o cancelado;
- outbox creado/procesado cuando aplique;
- variante generada, aprobada, rechazada o editada;
- calendario confirmado;
- post programado, publicado, fallido, cancelado, pausado o con `remoteStatus` cambiado;
- lote cancelado/abandonado;
- metricas recolectadas.

Los eventos deben guardar IDs de entidades, `businessId`, `actor`, `sourceModule` y `occurredAt`. No deben guardar tokens, prompts completos para UI, data URLs largas ni payloads crudos de proveedores.

## Reglas de cierre de lote

Constantes:

- `CLOSED_BATCH_STATUSES`: completado, cancelado, fallido, abandonado.
- `DISABLED_BATCH_STATUSES`: cancelado, fallido, abandonado.

`assertBatchCanBeWorked`

- bloquea acciones sobre cualquier lote cerrado.

`assertBatchIsNotDisabled`

- bloquea cancelado/fallido/abandonado pero permite algunas acciones sobre completado cuando aplica.

Al cancelar lote:

- batch pasa a `cancelado`;
- fotos no usadas pasan a `eliminada`;
- variantes no publicadas pasan a `eliminada`;
- scheduled posts no publicados pasan a `cancelada` solo si `remoteStatus = no_enviado` o si la cancelacion remota fue confirmada;
- scheduled posts ya confirmados en Meta pasan a `cancelacion_pendiente`, `estado_incierto` o `fallida` hasta resolver el side effect remoto;
- jobs pendientes relacionados pasan a `cancelled`;
- jobs corriendo deben revisar estado antes de escribir.

## AppError

Todo error funcional debe incluir:

- `code`;
- `statusCode`;
- `message` tecnico;
- `userMessage` humano;
- `details` opcional.

Regla:

- La app movil debe mostrar `userMessage`.
- `details` no debe incluir secretos ni payloads crudos.

## Variables de entorno API

Obligatorias/criticas:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `META_APP_ID`
- `META_APP_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE`

Configurables:

- `HOST`
- `PORT`
- `NODE_ENV`
- `OPENAI_VISION_MODEL`
- `OPENAI_IMAGE_MODEL`
- `OPENAI_IMAGE_SIZE`
- `OPENAI_IMAGE_TIMEOUT_MS`
- `OPENAI_CAPTION_MODEL`
- `META_BOOTSTRAP_TOKEN`
- `META_DEVICE_LOGIN_SCOPES`
- `SUPABASE_MEDIA_BUCKET`
- `SUPABASE_STATE_BUCKET`
- `SUPABASE_STATE_OBJECT`
- `WORKER_MODE`
- `REDIS_URL`
- `JOB_LOCK_TTL_MS`
- `JOB_POLL_INTERVAL_MS`

No guardar valores reales en docs ni repo.

## Reglas de reconstruccion

- Implementar primero `packages/shared`.
- Crear migraciones DB antes de UI compleja.
- Implementar providers con mocks antes de reales.
- Implementar servicios internos de IA pequenos y testeables.
- Implementar API con comandos y lecturas.
- Agregar tabla `jobs` y worker temprano.
- Agregar Supabase Storage para media.
- Agregar Meta real despues de tener mocks.
- Agregar OpenAI real despues de tener contratos y errores.
- La app movil debe consumir solo API publica.
