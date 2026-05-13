# Modulo 12 - Comunicacion entre modulos
### Contrato maestro de coordinacion eficiente

## Principio

FBmaniaco debe comunicarse como un sistema dirigido por comandos, lecturas, jobs, estados y eventos. Ningun modulo interpreta por su cuenta lo que ya decidio otro modulo.

Juicio despues de la ultima revision: esta sigue siendo la mejor forma de desarrollar FBmaniaco para el MVP profesional. La alternativa de microservicios, multiples lenguajes o colas externas agrega operacion antes de resolver el problema real. La arquitectura correcta es modular por responsabilidad, pero desplegada simple: app movil, API, DB/Storage/Queues, worker y proveedores.

Regla central:

- La app movil solo habla con la API.
- Supabase Auth identifica usuario/sesion de FBmaniaco; Meta solo autoriza paginas.
- La autorizacion Meta en produccion ocurre por Facebook Login/OAuth o Login for Business si aplica; device login solo se usa si Meta lo soporta para la configuracion vigente.
- La API valida comandos, sirve lecturas y crea jobs.
- La DB es la fuente primaria de verdad.
- Workers ejecutan jobs lentos o costosos.
- La inteligencia IA vive como servicios internos de API/worker.
- Providers ejecutan integraciones externas, pero no conservan estado de negocio.
- Supabase Storage guarda media y respaldos; no reemplaza la DB.
- Si Supabase Queues/PGMQ esta disponible, la cola fisica preferida es Postgres-native queue y `jobs` queda como ledger de negocio/progreso.
- Supabase Cron solo dispara mantenimiento, reportes o reencolado; no decide negocio.
- La app usa TanStack Query para cache remoto, invalidaciones y refetch controlado.
- Meta y OpenAI nunca se llaman desde el celular.

## Capas y responsabilidades

| Capa | Responsabilidad | Puede llamar a | No debe hacer |
| --- | --- | --- | --- |
| App movil | Presentar estado, capturar decisiones y refrescar pantallas con TanStack Query. | API publica HTTPS, Supabase Auth si aplica para sesion. | Guardar tokens Meta, llamar Meta/OpenAI, decidir reglas criticas. |
| API Fastify | Validar comandos, servir lecturas, crear jobs, autorizar usuario/workspace. | DB, cache, Supabase Auth, services internos, providers cuando sea accion corta. | Exponer secretos o ejecutar tareas largas bloqueando UI. |
| DB Postgres/Supabase | Fuente primaria de verdad. | N/A. | Ser reemplazada por runtime/snapshot. |
| Cache/runtime | Acelerar lecturas y progreso. | DB. | Ser fuente primaria. |
| Worker | Reclamar y ejecutar jobs. | DB, Queues/PGMQ, services internos, providers, Storage. | Exponer rutas al celular o duplicar publicaciones. |
| Servicios IA internos | Decidir estilo, riesgo, autonomia, prompts, memoria, ranking y reportes. | Datos recibidos desde API/worker. | Llamar proveedores directamente o persistir sin API/worker. |
| Providers | Adaptar Meta, OpenAI, Supabase Storage y notificaciones. | APIs externas autorizadas. | Inventar reglas de negocio o guardar estado propio. |
| Supabase Cron | Despertar mantenimiento, limpieza, reportes y reencolado. | DB, funciones SQL o endpoint interno seguro. | Programar cada post como cron individual o saltarse jobs. |

## Fuente de verdad

La fuente primaria de verdad es DB. Todo cambio relevante sigue este orden:

1. Validar usuario, workspace, negocio y estado.
2. Rechazar acciones incompatibles con estados cerrados.
3. Crear job y evento de salida en la misma transaccion si la accion es lenta/costosa.
4. Ejecutar decision interna si aplica.
5. Mutar DB dentro de transaccion cuando corresponda.
6. Registrar evento si la accion aporta auditoria o aprendizaje.
7. Responder a la app con datos sanitizados, `jobId`, `nextStep` y alertas cuando aplique.

Si falla DB, la API no responde exito. Si falla un provider dentro de un job, el job queda `failed`, `blocked` o `needs_user_action` con error sanitizado.

## Outbox transaccional

Para evitar inconsistencias entre "guardar estado" y "avisar/ejecutar trabajo", los comandos deben usar un outbox transaccional:

- En la misma transaccion que muta entidades, la API inserta `jobs` y `outbox_events`.
- El worker solo procesa jobs/eventos confirmados por la DB.
- Si falla el worker despues, el estado queda recuperable porque el job/evento ya existe.
- Si falla la transaccion, no queda job huerfano.

Regla:

- Todo comando que cree trabajo asincrono debe escribir entidad + job + evento en la misma transaccion.

## Comandos, lecturas y jobs

| Tipo | Uso | Regla |
| --- | --- | --- |
| Comando | Cambia estado o crea job. | Responde entidad cambiada, `changed`, `jobId` y `nextStep` si aplica. |
| Lectura | Muestra pantalla o summary. | No ejecuta efectos externos. |
| Job | Ejecuta IA, programacion, publicacion, reintentos o metricas. | Idempotente, cancelable si no hay side effect irreversible. |
| Outbox event | Entrega confiable de eventos internos. | Se escribe en la misma transaccion que la mutacion. |

## Cola fisica recomendada

Para simplificar operacion, la cola fisica recomendada es Supabase Queues/PGMQ cuando este disponible:

- `jobs` guarda estado de negocio, progreso, dedupe y relacion con entidades.
- La cola PGMQ guarda el mensaje ejecutable con `jobId`.
- El worker lee mensajes con visibility timeout.
- Si el worker termina bien, archiva/elimina el mensaje y marca job `succeeded`.
- Si falla, deja que el mensaje reaparezca o marca job `failed`/`blocked` segun causa.
- Si el worker inicio un side effect externo, registra `ExternalOperation`; al caer, el siguiente worker reconcilia antes de reintentar.

Fallback:

- Si PGMQ no esta disponible, usar tabla `jobs` con `FOR UPDATE SKIP LOCKED`.

Regla:

- La cola nunca reemplaza la tabla `jobs`; solo simplifica entrega y concurrencia.
- No usar lectura destructiva tipo `pop` para trabajos criticos; archivar/eliminar solo despues de persistir resultado.

## Payloads y errores

| Tipo | Uso | Regla |
| --- | --- | --- |
| Evento | Explica lo que paso. | No reemplaza estado. |
| Error | Falla funcional o tecnica. | Usa `AppErrorResponse` con `userMessage` seguro. |

Reglas:

- La app no debe reconstruir relaciones complejas si la API puede devolverlas ya resueltas.
- La API no debe devolver todo el runtime ni tablas crudas.
- Prompts, tokens, headers, payloads crudos y data URLs largas son backend/debug only.
- Fechas viajan como ISO string y se interpretan con `business.timezone`.
- Cada entidad enviada a UI debe incluir `id`, `status` y `updatedAt` cuando exista.

## Refresco eficiente de UI

La app debe usar query keys estables:

- `['bootstrap']`
- `['pages']`
- `['business', businessId]`
- `['dashboard', businessId]`
- `['batch', batchId]`
- `['jobs', businessId]`
- `['calendar', businessId, range]`
- `['settings', businessId]`

Despues de cada comando, la API devuelve `changed` y la app invalida solo las query keys afectadas. Realtime/Broadcast puede mejorar progreso de jobs, pero el fallback oficial siempre es refetch por HTTP.

Regla de idempotencia:

- Todo comando costoso o con side effect externo debe enviar `Idempotency-Key`.
- La API responde la misma mutacion confirmada o el mismo `jobId` si el usuario reintenta por mala red.
- Si la misma key llega con body distinto, la API devuelve 409 con `userMessage` claro.
- Antes de crear jobs costosos, la API reserva uso en `usage_meters`; el worker solo consume reservas vigentes.
- Jobs con side effects externos usan `operationKey` y `ExternalOperation`.
- Idempotencia HTTP evita duplicar comandos; `dedupeKey` evita duplicar jobs; `operationKey` evita duplicar llamadas externas. Las tres capas son obligatorias porque resuelven problemas distintos.

## Eventos de dominio

Eventos minimos:

- `pagina_seleccionada`
- `meta_autorizacion_actualizada`
- `meta_scopes_actualizados`
- `negocio_actualizado`
- `seo_actualizado`
- `estilo_creado`
- `estilo_actualizado`
- `estilo_eliminado`
- `job_creado`
- `job_completado`
- `job_fallido`
- `foto_validada`
- `variante_generada`
- `variante_aprobada`
- `variante_rechazada`
- `caption_editado_por_usuario`
- `calendario_confirmado`
- `post_programado`
- `post_publicado`
- `post_fallido`
- `post_remote_status_cambiado`
- `post_cancelado`
- `batch_cancelado`
- `batch_abandoned`
- `metricas_recolectadas`
- `metrica_no_disponible`
- `performance_summary_generado`

Formato recomendado:

```ts
type DomainEvent = {
  schemaVersion: "domain_event.v1";
  id: string;
  type: string;
  workspaceId: string;
  businessId?: string;
  batchId?: string;
  photoId?: string;
  variantId?: string;
  scheduledPostId?: string;
  jobId?: string;
  actorId?: string;
  actor: "user" | "system" | "worker" | "provider";
  occurredAt: string;
  sourceModule: string;
  payload?: Record<string, unknown>;
};
```

Reglas:

- El evento no debe contener secretos.
- El evento debe apuntar a entidades por ID.
- Eventos que cambian estados criticos deben incluir `fromStatus`, `toStatus` y `reasonCode` dentro de `payload` o seguir el contrato `StateTransition`.
- Si el evento afecta autonomia o memoria, los servicios internos de IA lo consumen desde DB.

## Refresco de UI

| Accion | Pantallas a refrescar | Motivo |
| --- | --- | --- |
| Conectar/reconectar Meta | boot, pages, home, calendar | Cambia token, paginas, alertas y posts pausados. |
| Seleccionar pagina | home, settings, calendar | Cambia negocio activo y timezone. |
| Crear/cancelar lote | home, batch, calendar | Cambia lote activo, jobs y posibles posts. |
| Completar upload | batch, home | Crea job `analyze_photo`. |
| Generar variantes | batch, home | Crea jobs `generate_batch`/`generate_variant`. |
| Aprobar/rechazar/editar caption | batch, home | Cambia resumen y aprendizaje. |
| Confirmar calendario | calendar, home, batch | Crea job `schedule_posts`. |
| Editar/cancelar/reintentar post | calendar, home | Cambia posts y jobs. |
| Cambiar SEO/estilos | settings; futuros lotes | Afecta nuevas generaciones, no historico publicado. |

Regla:

Despues de una mutacion, la API debe devolver la entidad cambiada y, cuando aplique, `jobId` y `nextStep`. La app puede actualizar optimistamente solo si el servidor confirmo la mutacion.

## Contrato entre modulos funcionales

| Modulo | Publica | Consume | Invalida/refresca |
| --- | --- | --- | --- |
| Auth FBmaniaco | usuario, sesion, workspace, actor, plan y entitlements sanitizados. | Supabase Auth, DB users/workspaces/billing. | bootstrap, home, configuracion. |
| Meta/onboarding | pagina activa, negocio, token status. | bootstrap, paginas Meta. | home, calendario, configuracion. |
| Home | acciones de crear/continuar/cancelar lote y resolver alertas. | dashboard, scheduled posts, business detail, jobs activos. | lote, calendario. |
| Lotes | fotos, analisis, variantes, aprobaciones, captions, jobs de generacion. | negocio, SEO, estilos, memoria, estados. | home, calendario, services IA. |
| Calendario | scheduled posts, cambios de fecha, reintentos, cancelaciones, jobs de publicacion. | variantes aprobadas, token, timezone. | home, alertas, memoria. |
| Configuracion | negocio, SEO, autonomia, estilos. | business detail, catalogo estilos. | futuras generaciones y captions. |
| IA interna | decisiones, planes, predicciones, reportes. | eventos, negocio, estilos, vision, historial. | variantes, captions, reportes. |
| API/datos | contratos, DB, jobs, errores, respaldos. | todos los modulos. | todos los consumidores. |
| Seguridad/despliegue | reglas de exposicion, entorno y operacion. | API, worker, providers, build movil. | criterios de publicacion. |
| UX/QA | validacion visual y funcional. | todos los contratos visibles. | definicion de terminado. |

## Contrato tecnico de desarrollo

| Pieza | Se desarrolla en | Se comunica por | Regla |
| --- | --- | --- | --- |
| App movil | TypeScript/TSX, Expo, TanStack Query | HTTPS API, query keys, SecureStore para sesion | No llama providers externos ni guarda secretos Meta. |
| API | TypeScript, Fastify, TypeBox/JSON Schema | Commands, reads, OpenAPI, DB transactions | Coordina permisos, estados, jobs y respuestas sanitizadas. |
| DB | SQL, migraciones, constraints, views | Queries transaccionales | Es fuente primaria, no solo cache. |
| Automatismos DB | PL/pgSQL acotado | Triggers/summaries locales | No llama Meta/OpenAI ni decide UX. |
| Cola | Supabase Queues/PGMQ | Mensaje minimo con `jobId` | No reemplaza `jobs`; solo entrega trabajo. |
| Worker | TypeScript Node.js | PGMQ/jobs, providers, Storage | Ejecuta tareas lentas, idempotentes y observables. |
| Media | Supabase Storage + Sharp si aplica | `UploadIntent`, `MediaAsset`, URLs renderizables, metadata | No pasar base64 entre modulos; originales y generados no aprobados quedan privados. |
| Observabilidad | Sentry + logs estructurados + trazas compatibles OTel | `release`, `requestId`, `traceId`, `userId`, `workspaceId`, `batchId`, `jobId`, `operationKey` | Cada error externo debe quedar trazable sin exponer secretos. |

## Flujos canonicos

### Arranque

```text
App -> GET /auth/bootstrap-status
API -> DB/cache
API -> response nextStep
App -> pantalla connect_meta | recover_meta | select_page | home
```

### Generacion

```text
App -> crear/abrir lote
App -> upload-intent -> subida binaria directa a Storage privado -> complete-upload
API -> UploadIntent + MediaAsset original + job analyze_photo
Worker -> derivados privados + OpenAI Vision + foto validada
App -> estimate-cost + confirm-cost + generate
API -> jobs generate_batch/generate_variant
Worker -> services IA + OpenAI image/caption + MediaAsset generated
Al aprobar/programar -> MediaAsset publishable + validacion URL Meta
Worker -> variante generada + evento + job succeeded
App -> swipe aprobacion
```

### Programacion

```text
App -> calendar/confirm con periodo
API -> job schedule_posts
Worker -> ranking interno + fechas por timezone
Worker -> scheduled posts + jobs publish_post
Worker -> Meta Graph cuando corresponde
App -> calendario/home refrescan
```

### Reconexion

```text
Meta/API detecta token invalido
API/Worker -> marca negocio y posts como pausados por token
Home/Calendario -> alerta de reconexion
App -> POST /auth/meta/connect o POST /auth/meta/refresh
API -> valida credencial tecnica, refresca paginas, actualiza status
API -> jobs pausados pueden reintentarse
```

## Reglas de eficiencia

- Preferir endpoints agregados para pantallas principales: dashboard, batch detail y calendario.
- Evitar polling rapido; usar refresco manual, foco de pantalla y polling moderado solo durante jobs activos.
- En app movil, preferir cache de servidor con invalidacion dirigida por pantalla/entidad en vez de estado global manual.
- Realtime/Broadcast puede acelerar progreso de jobs, pero siempre con polling/fetch de respaldo porque la DB sigue siendo la verdad.
- Durante generacion, pedir progreso por lote/job; no descargar imagenes completas repetidamente.
- Las listas deben usar summaries; los detalles se piden al abrir pantalla.
- Las imagenes viajan como URLs renderizables, no como base64; `imageDataUrl` queda solo como fallback de desarrollo/emergencia.
- La app debe cachear solo datos no sensibles y descartables.
- Las mutaciones costosas deben crear jobs idempotentes.
- Las mutaciones costosas deben validar entitlements server-side antes de crear jobs.
- Workers deben usar PGMQ/visibility timeout o, como fallback, bloqueo de fila con `FOR UPDATE SKIP LOCKED`.
- Workers deben tratar proveedores externos como al menos una vez y reconciliar resultados ambiguos antes de reintentar.

## Reglas anti-contradiccion

- Si hay desacuerdo entre documentos, este contrato y `11_datos.md` mandan sobre nombres de entidades, estados, jobs y relaciones.
- Si hay desacuerdo sobre exposicion de secretos, manda `10_seguridad.md`.
- Si hay desacuerdo sobre rutas y respuestas, manda `08_api.md` alineado con este contrato.
- Si hay desacuerdo sobre comportamiento visible, manda `12_ux_qa.md` siempre que no contradiga seguridad ni datos.

## Checklist de comunicacion perfecta

- Cada modulo tiene una entrada clara, una salida clara y estados esperados.
- Cada comando declara que entidades y query keys quedan obsoletas.
- Toda mutacion sabe que pantallas debe refrescar.
- Toda tarea lenta corre por job.
- Ningun modulo movil conoce secretos.
- Ninguna pantalla trabaja con lote cerrado.
- Ningun post se publica dos veces por reintento.
- Toda accion critica persiste en DB antes de responder exito.
- Todo error tiene `userMessage` seguro.
- Todo aprendizaje se registra como evento.
- Todo cambio de SEO/estilo afecta solo generaciones futuras.
- Todo dato mostrado al usuario viene sanitizado desde API.
- Todo provider externo esta detras de una interfaz mockeable antes de integrarse en produccion.
- Todo flujo critico tiene al menos una prueba unitaria de dominio y una prueba E2E movil o smoke test.
