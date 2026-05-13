# Modulo 4 - Calendario y publicacion
### Programacion real de posts de Facebook

## Principio de diseno

El calendario es el centro operativo despues de aprobar variantes. Debe mostrar que publicaciones existen, en que estado estan, y permitir corregir problemas sin salir del celular.

No es un calendario decorativo. Es un tablero de ejecucion.

Debe dar tranquilidad: el usuario debe ver rapidamente si su semana esta cubierta, que posts estan confirmados y que necesita atencion. Las reglas de IU y engagement etico viven en `16_ui_engagement.md`.

Principio tecnico:

- FBmaniaco agenda en su propia DB primero.
- El envio a Meta siempre lo ejecuta el backend/worker, nunca la app movil.
- Para posts de una sola imagen, la ruta preferida es publicar como foto de Page (`/{page-id}/photos`) usando URL HTTPS publicable y `caption`.
- La programacion remota dentro de Meta es una capacidad opcional por pagina/proveedor; no debe asumirse como universal ni como unica fuente de verdad.
- El modo por defecto recomendado para MVP es `local_due_publish`: FBmaniaco guarda el calendario y publica cuando llegue la hora.
- `remote_schedule` solo se activa si la pagina, version Graph API y pruebas reales confirman que crear, consultar y cancelar posts programados funcionan de forma consistente.

## Entrada al calendario

Se abre desde:

- Home, tocando mini calendario.
- Home, alerta de publicaciones fallidas.
- Resumen de lote despues de programar.
- Configuracion o top bar de calendario.

Datos:

`GET /businesses/:businessId/scheduled-posts`

Devuelve lista de publicaciones programadas del negocio.

## Pantalla C1 - Calendario semanal/mensual

Vista inicial recomendada:

- semana actual;
- proximos 7 dias;
- cobertura semanal;
- posts con error arriba como alerta.

La vista mensual queda como expansion secundaria para planificacion. El usuario diario necesita saber que pasara esta semana antes que navegar todo el mes.

### Layout

- Top bar:
  - titulo `Calendario`;
  - nombre de negocio;
  - botones:
    - Reporte;
    - Ajustes;
    - Volver.
- Card principal:
  - titulo `Semana` o `Mes`;
  - subtitulo `Programa real en Facebook`;
  - toolbar semana/mes anterior/siguiente;
  - toolbar Hoy / Abrir lote / Actualizar;
  - header de dias de semana;
  - barra de cobertura semanal;
  - leyenda;
  - grid semanal o mensual.

### Grid

Cada celda:

- dia del mes;
- hasta 3 puntos de colores;
- contador si hay posts.

Colores:

- programada: acento;
- publicada: success;
- fallida: danger;
- pausada: gris.

### Responsividad

En pantalla pequena:

- botones se vuelven iconicos;
- leyenda oculta texto y deja puntos;
- footnote se oculta.

## Seleccion de dia

Al tocar un dia:

- se abre bottom sheet;
- titulo con fecha humanizada;
- lista de publicaciones de ese dia ordenadas por hora.

Cada item muestra:

- nombre de estilo o `Sin estilo`;
- status pill;
- fecha/hora local;
- preview de caption.

Si no hay publicaciones:

- texto `Ese dia no tiene publicaciones.`
- accion `Crear lote` si la semana tiene huecos.

## Detalle de publicacion

Al tocar una publicacion:

- se abre otro modal/bottom sheet de detalle.

Contenido:

- imagen de la publicacion;
- status pill;
- estilo;
- fecha/hora;
- caption completo;
- numero de intentos;
- acciones disponibles.

## Acciones de detalle

### Cambiar fecha y hora

Disponible solo si status es `programada`.

UI:

- boton `Cambiar fecha y hora`;
- al tocar, aparecen inputs:
  - fecha `AAAA-MM-DD`;
  - hora `HH:MM`;
- botones `Guardar` y `Cancelar`.

Endpoint:

`PATCH /businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId`

Body:

- `scheduledFor`.

Efecto:

- post vuelve a `programada`;
- variante vuelve a `programada`;
- persistencia.

Regla obligatoria:

- Si el post ya fue creado/programado en Meta, cambiar fecha/hora debe intentar actualizar tambien el post remoto cuando Graph API lo permita.
- Si Meta no permite editar ese objeto, el sistema debe cancelar/recrear de forma idempotente o dejar el post en `estado_incierto` con accion clara.
- Nunca basta con cambiar solo la fecha local si existe `facebookPostId`.

### Reintentar

Disponible si:

- `fallida`;
- `pausada_por_token`.

Endpoint:

`POST /businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId/retry`

Efecto:

- invoca publicacion/programacion otra vez;
- si token sigue mal, queda fallida o pausada;
- si funciona, guarda `facebookPostId` y status.

### Cancelar publicacion

Disponible si:

- status no es `publicada`;
- status no es `cancelada`.

Endpoint:

`POST /businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId/cancel`

Efecto:

- post `cancelada` solo si no habia side effect remoto o si la cancelacion remota fue confirmada;
- variante vuelve a `aprobada`;
- persistencia.

Regla obligatoria:

- Si Meta tiene post remoto programado, cancelar desde FBmaniaco debe cancelar/eliminar tambien el objeto remoto cuando Graph API lo permita.
- Si la cancelacion remota falla, el post queda `estado_incierto` o `fallida` segun causa, y la UI debe explicar que requiere revision para evitar duplicado.
- No se permite mostrar `cancelada` como si todo estuviera resuelto cuando solo se cancelo localmente.

## Programacion automatica desde lote

Endpoint:

`POST /businesses/:businessId/batches/:batchId/calendar/confirm`

Body:

- `periodDays`: 7, 14 o 30.

### Seleccion de variantes

La API toma variantes:

- `aprobada`;
- `generada`;
- no ya programadas en otro scheduled post.

Si no hay variantes:

- error 409: `Primero aprueba al menos una variante...`

### Orden de variantes

Las variantes se ordenan por prediccion de performance:

- content type: `producto`;
- styleId de variante;
- dia y hora actual;
- caption tone `afirmacion`;
- memoria historica.

La prediccion no bloquea. Solo ordena.

### Distribucion en dias

El sistema construye offsets preferidos dentro del periodo:

- 7 dias: mas concentrado;
- 14 dias: intermedio;
- 30 dias: mas espaciado.

Despues evita sobrecargar dias que ya tienen posts del mismo negocio.

### Hora de publicacion

Se usa una funcion de construccion de fecha por offset y carga diaria. Conceptualmente:

- dia base = manana o siguiente dia local;
- si ya hay posts ese dia, se desplaza hora;
- genera `scheduledFor` ISO.

### Envio a Meta

El envio debe ejecutarse por jobs, no como trabajo largo dentro del request movil.

Hay dos modos validos, segun capacidad de Meta y decision operativa:

- `local_due_publish`: el worker crea scheduled post local `programada` con `remoteStatus = no_enviado`; un job `publish_post` se ejecuta cerca de `scheduledFor` y publica inmediatamente en Meta.
- `remote_schedule`: el worker crea un scheduled post remoto en Meta al confirmar calendario; guarda `facebookPostId`/`remotePostId`, `remoteStatus = confirmado_meta` y luego reconcilia el resultado.

Regla:

- La UI debe poder distinguir ambos casos mediante `remoteStatus`.
- Si `remoteStatus = confirmado_meta`, editar/cancelar debe sincronizar Meta.
- Si `remoteStatus = no_enviado`, editar/cancelar puede resolverse localmente y actualizar jobs pendientes.
- La decision de modo vive en backend por `businessId`/`facebookPageId`, no en el cliente.
- Si `remote_schedule` falla por capacidad, permisos, bug temporal de Meta o version Graph, el sistema puede degradar a `local_due_publish` antes de crear side effect remoto, dejando evento auditable.

Por cada variante aprobada:

1. API crea job `schedule_posts` al confirmar calendario.
2. Worker determina imagen:
   - primero imagen generada;
   - si no existe, foto original.
3. Mensaje = caption.
4. PageId = pagina del negocio.
5. scheduledFor = hora elegida.
6. Crea scheduled post con `dedupeKey` y `remoteStatus` inicial.
7. Crea/reclama job `publish_post` cuando corresponda enviar a Meta, ya sea para programar remoto o publicar ahora.
8. Worker llama proveedor Facebook segun `deliveryMode` y `contentKind`.
9. Si Meta devuelve post id:
   - variante `programada`;
   - scheduled post `programada`;
   - `remoteStatus = confirmado_meta`;
   - guarda `facebookPostId`.
10. Si falla:
   - variante vuelve a `aprobada`;
   - scheduled post `fallida`;
   - retryCount 1;
   - si parece credencial Meta vencida, negocio y pagina pasan a `expirado`.

### Contrato de publicacion Meta

El provider Meta debe recibir un comando minimo y explicito:

```ts
type MetaPublishCommand = {
  scheduledPostId: string;
  operationKey: string;
  graphApiVersion: string;
  pageId: string;
  pageAccessTokenRef: string;
  contentKind: "photo_post";
  deliveryMode: "local_due_publish" | "remote_schedule" | "publish_now";
  caption: string;
  publicImageUrl: string;
  scheduledFor?: string;
};
```

Mapeo recomendado:

| Caso | Endpoint Graph | Parametros clave |
| --- | --- | --- |
| Publicar foto ahora | `POST /{page-id}/photos` | `url`, `caption`, page access token. |
| Programar foto en Meta | `POST /{page-id}/photos` | `url`, `caption`, `published=false`, `scheduled_publish_time` como Unix seconds, page access token. |
| Leer/reconciliar post | `GET /{post-id}` o edge disponible para scheduled posts de Page | Campos minimos: `id`, `created_time`, `scheduled_publish_time`, `status_type`/estado disponible, `permalink_url` si existe. |
| Cancelar/eliminar remoto | `DELETE /{post-id}` cuando Graph lo permita | Requiere page access token y evidencia de exito. |

Reglas:

- Usar siempre version Graph explicita configurada, nunca llamadas sin version.
- Guardar `graphApiVersion` en `ScheduledPost` y `ExternalOperation`.
- Antes de llamar Meta, validar URL publicable con `HEAD` o `GET` server-side.
- La URL enviada a Meta no debe ser signed URL corta si puede expirar antes de que Meta la lea; usar media publicable controlada o URL de vida suficiente.
- `scheduled_publish_time` solo se envia en `remote_schedule`; en `local_due_publish` se publica al llegar la hora sin programar dentro de Meta.
- El worker debe convertir `scheduledFor` desde timezone del negocio a Unix seconds y registrar ambos valores.
- Nunca enviar `attached_media`/feed multiphoto en MVP; FBmaniaco publica una variante = una imagen = un photo post.
- Si el provider devuelve `fbtrace_id`/error trace, guardar solo en logs/JobAttempt sanitizado.

### Capabilities por pagina

Cada pagina conectada debe tener una evaluacion operativa de publicacion:

```ts
type MetaPublishingCapability = {
  facebookPageId: string;
  graphApiVersion: string;
  canPublishPhoto: boolean;
  canRemoteSchedulePhoto: boolean;
  canDeleteRemotePost: boolean;
  canReadScheduledPosts: boolean;
  preferredDeliveryMode: "local_due_publish" | "remote_schedule";
  lastProbeAt?: string;
  lastProbeResult?: "passed" | "failed" | "partial";
  lastErrorCode?: string;
};
```

Reglas:

- `canPublishPhoto` es requisito para cualquier publicacion.
- `remote_schedule` requiere `canRemoteSchedulePhoto`, `canReadScheduledPosts` y `canDeleteRemotePost` probados.
- Si no hay prueba reciente, usar `local_due_publish`.
- La prueba no debe publicar contenido visible a clientes; debe usar pagina/tester de desarrollo o flujo controlado de App Review.

## Estados de scheduled post

`pendiente`

- Estado inicial posible.
- No debe quedarse mucho tiempo visible.

`programada`

- Meta confirmo programacion o el job local aun no la ha enviado y esta lista para envio.
- Permite editar fecha/hora y cancelar.

Campo recomendado:

- `remoteStatus`: `no_enviado`, `confirmado_meta`, `actualizacion_pendiente`, `cancelacion_pendiente`, `incierto`.
- `deliveryMode`: `local_due_publish`, `remote_schedule`, `publish_now`.
- `remotePostType`: `photo`, `feed`, `unknown`.
- `remotePostUrl`: permalink si Meta lo devuelve.
- `lastRemoteSyncAt`: ultima verificacion.

`publicacion_en_proceso`

- Se usa mientras se publica/reintenta.

`publicada`

- Post llego a Meta y no debe cancelarse desde la app.

`estado_incierto`

- Timeout, caida de worker o respuesta ambigua despues de iniciar llamada Meta.
- Tambien aplica si Meta devuelve exito parcial pero no podemos leer el objeto.
- Requiere reconciliacion antes de publicar, editar, cancelar o reintentar.

`fallida`

- Meta o proveedor rechazo.
- Permite reintentar.

`pausada_por_token`

- El token vencio.
- Requiere reconectar antes de reintentar.

`cancelada`

- Cancelada localmente si `remoteStatus = no_enviado`.
- Cancelada tambien en Meta si ya estaba `confirmado_meta`.
- Si la cancelacion remota falla, no usar este estado; usar `estado_incierto` o `fallida` con accion visible.

## Worker

Existe `apps/worker` para ejecutar jobs:

- reclama jobs `queued`;
- lee DB;
- ubica scheduled post;
- ubica negocio, pagina, variante, foto;
- publica en Meta o ejecuta tarea IA;
- actualiza status;
- registra eventos.

En el diseno profesional, el worker debe manejar desde el inicio:

- vision de fotos;
- generacion de variantes;
- programacion automatica;
- publicaciones futuras;
- reintentos con backoff;
- limpieza;
- monitoreo de tokens;
- recuperacion de estado incierto.

Jobs de calendario:

- `schedule_posts`: crea `ScheduledPost` locales y decide `deliveryMode`.
- `publish_post`: llama Meta para publicar ahora, programar remoto o publicar al vencimiento local.
- `sync_remote_post`: consulta Meta para confirmar estado remoto de un post existente.
- `cancel_remote_post`: cancela/elimina un post remoto cuando existe `facebookPostId`.
- `reconcile_external_operation`: resuelve ambiguedad de `publish_post`, `sync_remote_post` o `cancel_remote_post`.

Reglas:

- Un job local de publicacion debe ejecutarse con margen: `runAfter` <= `scheduledFor - publishLeadSeconds` cuando el modo requiera preparacion.
- Si `scheduledFor` ya paso, `publish_post` solo publica si esta dentro de una ventana de tolerancia configurada; si no, pasa a `needs_user_action`.
- Si el worker estuvo caido, no debe publicar en masa posts atrasados sin regla explicita.
- Cada `publish_post` usa `operationKey = meta_publish:{scheduledPostId}`.
- Cada cancelacion remota usa `operationKey = meta_cancel:{scheduledPostId}:{remotePostId}`.
- Cada sync usa `operationKey = meta_sync:{scheduledPostId}:{remotePostId}`.

## Interfaz con alertas

Home genera alertas si hay:

- acceso Meta expirado;
- publicaciones fallidas;
- publicaciones pausadas por credenciales Meta.

Calendario es la pantalla de resolucion de esas alertas.

## Interfaz con otros modulos

- Consume de Lotes: variantes `aprobada`, `batchId`, captions finales e imagenes publicas.
- Consume de Meta/onboarding: token status y page access token solo en backend.
- Consume de Configuracion: timezone, horarios preferidos y restricciones futuras de calendario.
- Consume de servicios internos de IA via API/worker: orden sugerido por prediccion y distribucion de publicaciones.
- Publica para Home: scheduled posts resumidos, alertas de fallas y estado de publicaciones pausadas.
- Publica para IA/memoria: eventos `post_programado`, `post_publicado`, `post_fallido`, `post_cancelado` y metricas futuras.
- Publica/consume jobs: `schedule_posts`, `publish_post`, `retry_post`, `sync_remote_post`, `cancel_remote_post`, `reconcile_external_operation`, `collect_metrics`.
- Invalida/refresca: Home despues de programar, editar, cancelar, publicar o reintentar; Reconexion si aparece `pausada_por_token`.

Regla de eficiencia:

- Calendario debe pedir scheduled posts por negocio y mes/rango cuando se agregue paginacion. Para MVP puede consumir lista compacta, pero nunca debe recibir prompts ni tokens.

## Reglas de seguridad

- No permitir update/cancel/publish si batch esta `cancelado`, `fallido` o `abandonado`.
- Permitir operaciones razonables en batch `completado` si son posts programados existentes, salvo que comprometan duplicados.
- Nunca publicar sin caption si el usuario espera texto; si caption esta vacio, mostrar `Sin caption` pero enviar string vacio solo si es intencional.
- No usar imagen local privada; Meta necesita URL HTTPS accesible por sus servidores.
- Antes de llamar Meta, el worker valida que exista `publishableAssetId`, que su URL responda correctamente y que MIME/tamano sean compatibles.
- Si la URL publicable falla, el post queda `fallida` o `estado_incierto` segun momento; no intentar publicar con original privado.
- No mostrar `publicada` hasta tener evidencia de Meta: `facebookPostId` confirmado, lectura posterior o respuesta de publish considerada suficiente y auditada.
- No mostrar `cancelada` para un post remoto hasta tener evidencia de delete/cancel remoto o confirmacion de que nunca fue enviado.

## Copy relevante

- `Calendario`
- `Programa real en Facebook`
- `Selecciona un dia para ver, editar o reintentar sus publicaciones.`
- `Detalle de publicacion`
- `Cambiar fecha y hora`
- `Reintentar`
- `Cancelar publicacion`
- `Ese dia no tiene publicaciones.`


