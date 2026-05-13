# Modulo 11 - UX, navegacion, sistema visual y QA

Fecha de corte: 2026-05-08
Objetivo: documentar la experiencia movil completa y los criterios de prueba necesarios para validar que FBmaniaco puede usarse desde el celular sin depender de una PC.

## Principio

FBmaniaco no es una pantalla de marketing. Es una herramienta diaria para crear publicaciones reales.

La experiencia debe sentirse:

- Directa.
- Movil primero.
- Segura antes de publicar.
- Clara cuando Meta falla.
- Visualmente generosa con imagenes.
- Rapida para aprobar o rechazar variantes.

La IU debe seguir `16_ui_engagement.md`: practica, recurrente por utilidad y sin patrones oscuros. El producto debe motivar a volver porque reduce trabajo real, no porque presiona o culpa al usuario.

Regla anti-redundancia:

- `16_ui_engagement.md` define patrones y componentes.
- Este modulo valida cumplimiento y pruebas.
- Los modulos de pantalla definen variaciones concretas, no reglas generales nuevas.

## Registro de pantallas

Pantallas actuales:

| Key | Pantalla | Proposito |
| --- | --- | --- |
| `boot` | Carga inicial | Revisar conexion API y estado bootstrap. |
| `meta_connect` | Conexion Meta | Conectar Facebook/Meta con autorizacion oficial OAuth/device login. Token manual solo soporte/desarrollo. |
| `reconnect` | Reconexion | Recuperar permisos cuando el acceso Meta expira. |
| `pages` | Seleccion de pagina | Elegir pagina de Facebook. |
| `welcome` | Bienvenida de pagina | Confirmar pagina y explicar inicio. |
| `home` | Dashboard | Ver alertas, lote activo, calendario y acciones. |
| `batch` | Crear publicaciones | Subir fotos, generar, aprobar/rechazar. |
| `calendar` | Calendario | Ver, editar, cancelar, publicar o reintentar posts. |
| `settings` | Configuracion | Negocio, autonomia, SEO, cuenta. |
| `styles` | Editor de estilos | Crear/editar estilos visuales. |
| `report` | Reporte | Ver aprendizaje y resumen semanal. |

## Resolucion de pantalla inicial

```txt
sin status -> boot
nextStep connect_meta -> token
nextStep recover_meta -> token o reconnect
nextStep select_page -> pages
nextStep home -> home
```

Regla:

- Si no hay API, mostrar error simple de conexion.
- Si la API responde pero no hay Meta, ir a token.
- Si hay Meta pero no pagina seleccionada, ir a pages.
- Si hay pagina, ir a home.

## Navegacion principal

La navegacion debe manejar historial simple:

- `pushScreen(next)` agrega pantalla actual al historial.
- `replaceScreen(next)` cambia sin historial.
- `goBack()` vuelve a pantalla anterior.

Reglas de fallback:

- Desde `boot`, si el usuario navega, usar fallback seguro.
- Si no hay historial, `home` es fallback cuando hay negocio.
- Si se pierde token, mandar a `reconnect`.
- Si se cambia pagina, recargar negocio y dashboard.

### Navegacion inferior

La definicion visual y funcional de tabs vive en `16_ui_engagement.md`.

Validacion QA:

- Hay 4 tabs despues de onboarding: Hoy, Crear, Calendario y Negocio.
- La tab activa es evidente.
- Las alertas criticas pueden marcar Hoy o Calendario con badge discreto.
- Back de Android cierra sheets/modales antes de salir de pantalla.
- Reportes no aparecen como tab independiente mientras no sean uso frecuente.

## Flujo completo ideal

```txt
boot
  -> token
  -> pages
  -> welcome
  -> home
  -> batch
      -> upload
      -> review photos
      -> choose variants
      -> generating
      -> approval swipe
      -> summary
  -> calendar
  -> home
```

Flujo de reconexion:

```txt
home alerta token
  -> reconnect
  -> pages si cambiaron permisos
  -> home si pagina sigue disponible
```

Flujo de estilos:

```txt
home/settings
  -> styles
  -> create/edit style
  -> back
```

## Sistema visual movil

### Layout base

- App en portrait.
- Fondo oscuro de trabajo.
- Contenido con scroll.
- Footer fijo cuando haya acciones primarias.
- Botones grandes para pulgar.
- Textos cortos y claros.
- Usar los componentes base definidos en `16_ui_engagement.md`.

### Jerarquia

- Header: pagina/negocio actual y accion secundaria.
- Cuerpo: tarea actual y siguiente paso.
- Footer: accion principal.
- Alertas: arriba del contenido, con color segun severidad.
- La siguiente accion y la cobertura semanal se validan desde Home/Calendario.

### Imagenes

Regla mas importante:

En revision/aprobacion, la imagen debe verse completa. No debe forzarse a llenar toda la pantalla con recorte que oculte partes relevantes.

Para posts de Facebook:

- Generar variantes cuadradas 1:1.
- Mostrar contenedor cuadrado o casi cuadrado.
- Usar resize mode tipo `contain`, no `cover`, cuando se revisa aprobacion.
- Dejar texto/caption debajo de la imagen.
- En pantallas pequenas, imagen arriba y acciones abajo.

Regla por pantalla:

| Pantalla | Comportamiento de imagen |
| --- | --- |
| Upload | Thumbnail puede ser recortado levemente, pero debe abrir detalle completo. |
| Detalle foto | Mostrar completa. |
| Generating | Placeholder estable, sin saltos. |
| Approval | Imagen completa, 1:1, sin recorte forzado. |
| Calendar detail | Imagen visible sin tapar fecha/caption. |

## Componentes esperados

La especificacion de componentes base vive en `16_ui_engagement.md`. Este modulo valida que cada componente exista, se use en las pantallas correctas y no rompa seguridad, navegacion ni accesibilidad.

Checklist minimo:

- Bottom navigation visible despues de onboarding.
- Action footer presente cuando hay accion primaria.
- Job progress card reemplaza spinners largos.
- Alert card tiene una accion principal clara.
- Swipe approval card conserva imagen completa y botones visibles.
- Week coverage bar aparece en Home/Calendario cuando hay negocio activo.
- Empty states ofrecen accion concreta.

### Boton primario

Uso:

- Continuar.
- Generar.
- Aprobar calendario.
- Publicar ahora.

Estados:

- Normal.
- Loading.
- Disabled.
- Error si aplica.

Reglas:

- No permitir doble tap en acciones costosas.
- Mostrar texto de progreso.

### Boton secundario

Uso:

- Volver.
- Editar.
- Reintentar.
- Ver estilos.

### Boton destructivo

Uso:

- Cancelar lote.
- Cancelar publicacion.
- Rechazar variante.

Reglas:

- Pedir confirmacion cuando destruya trabajo.
- Si ya llego a Meta, explicar que no se puede deshacer igual.

### Alerta

Campos:

- Mensaje.
- Nivel: info/warning/critical.
- Accion opcional.

Tipos:

- Token.
- Post fallido.
- Lote abandonado.
- Sistema.

### Tarjeta de lote activo

Debe mostrar:

- Estado.
- Conteo de fotos.
- Conteo de variantes.
- Ultima actividad.
- Accion principal contextual.

No debe mostrar:

- Lote cancelado como activo.
- Acciones de trabajo si lote esta cerrado.

### Swipe/card de variante

Debe mostrar:

- Imagen completa.
- Nombre de estilo.
- Caption editable.
- Boton aprobar.
- Boton rechazar.
- Progreso: `1 de N`.

Debe permitir:

- Editar caption antes de aprobar.
- Aprobar una variante.
- Rechazar una variante.
- Ver siguiente.

No debe permitir:

- Aprobar variante fallida.
- Aprobar variante de lote cancelado.
- Editar si ya esta publicada.

## Copy funcional

### Acceso Meta expirado

Texto:

```txt
Facebook necesita reconexion para publicar.
```

Accion:

```txt
Reconectar
```

### Publicacion pausada por token

Texto:

```txt
La publicacion esta pausada porque Facebook pidio reconexion.
```

Accion:

```txt
Reconectar Facebook
```

### Lote cancelado

Texto:

```txt
Este lote fue cancelado y ya no se puede continuar.
```

Accion:

```txt
Crear lote nuevo
```

### Generacion fallida

Texto:

```txt
No se pudo generar esta variante. Intenta con menos fotos o vuelve a intentar.
```

### Imagen demasiado pesada

Texto:

```txt
La foto es demasiado pesada. Intenta con una imagen mas ligera.
```

## Reglas de responsividad

### Pantalla chica

- Imagen de aprobacion con ancho maximo del contenedor.
- Caption debajo.
- Botones en fila si caben, o columna si no.
- Footer no debe tapar texto.
- Scroll debe llegar al final aunque teclado este abierto.

### Pantalla mediana/grande

- Mantener ancho maximo legible.
- No estirar imagen mas alla de su contenedor.
- Evitar espacios vacios enormes.

### Teclado

En edicion de caption:

- La pantalla debe hacer scroll.
- Botones importantes no deben quedar inaccesibles.
- No perder texto escrito al cambiar de foco.

## Estados de carga

### Boot

Debe mostrar:

- Estado de conexion inicial.
- Error si API no responde.

No debe mostrar:

- Pantalla en blanco infinita.

### Generating

Debe mostrar:

- Paso actual.
- Numero de variantes esperadas.
- Opcion de cancelar.

Regla:

- Cancelar debe cerrar el lote o marcarlo no trabajable aunque el proveedor tarde.

### Calendar

Debe mostrar:

- Loading mientras consulta posts.
- Empty state si no hay posts.
- Error accionable si falla.

## QA funcional

### Auth y paginas

| Caso | Pasos | Esperado |
| --- | --- | --- |
| API apagada | Abrir app sin API | Error claro, no pantalla rota. |
| Sin Meta | Abrir app limpia | Pantalla Conexion Meta. |
| Autorizacion rechazada | Cancelar permiso en Facebook | Mensaje claro, no crash, permite reintentar. |
| Token manual invalido soporte | Habilitar modo soporte y pegar token invalido | Mensaje claro, no crash. |
| Autorizacion valida con una pagina | Conectar | Entra a welcome/home. |
| Autorizacion valida con varias paginas | Conectar | Lista paginas. |
| Permisos granulares incompletos | Autorizar sin marcar una pagina | La pagina aparece no disponible o se explica como reconectar. |
| Falta `pages_manage_posts` | Autorizar sin permiso de publicacion | No permite seleccionar/publicar; pide reconexion. |
| App Review pendiente | Workspace externo intenta publicar | Bloqueo claro; testers/dev pueden probar segun modo Meta. |
| Cambiar pagina | Ir a selector | Dashboard cambia de negocio. |
| Acceso Meta expirado | Simular error Meta | Alerta y reconexion. |

### Lotes

| Caso | Pasos | Esperado |
| --- | --- | --- |
| Crear lote | Home -> crear | Batch pending_upload. |
| Subir foto valida | Agregar imagen | Foto analizada y validada. |
| Subir foto pesada | Agregar imagen enorme | Error amable. |
| Upload directo | Subir imagen con signed URL | API no recibe base64; `complete-upload` verifica `storageKey` y crea job. |
| Upload intent vencido | Completar subida tras expiracion | API rechaza y no crea `Photo` ni job. |
| MIME falso | Subir archivo con extension imagen pero MIME/contenido invalido | API rechaza y registra error sanitizado. |
| Thumbnail/derivado | Completar upload valido | Se crea `MediaAsset original`, thumbnail/vision input privado y metadata ancho/alto/hash. |
| Reintento de mutacion | Repetir confirmacion/generacion con misma `Idempotency-Key` | No duplica jobs, costos ni publicaciones. |
| Misma key distinto body | Repetir mutacion con otro payload | API responde 409 y no crea job nuevo. |
| Job running vencido sin proveedor | Simular worker caido antes de llamada externa | Job vuelve a `queued` y se ejecuta una sola vez. |
| Job running vencido con proveedor iniciado | Simular caida tras `provider_started` | Job queda en reconciliacion/ambiguous, no repite side effect a ciegas. |
| Publicacion Meta ambigua | Timeout despues de llamar Meta | Scheduled post queda `estado_incierto`; retry exige reconciliacion. |
| Generacion IA ambigua | Timeout despues de llamar imagen | Variante no se duplica si ya hay `imageUrl`; si no hay resultado, reintento registra costo potencial. |
| Reconciliacion unica | Disparar dos reconciliaciones para la misma operacion ambigua | Solo existe un job `reconcile_external_operation` activo por `operationKey`. |
| Confirmar costo | Elegir variantes | Costo calculado y confirmable. |
| Costo por version | Cambiar pricing server-side | Estimacion muestra version/precio vigente; cliente no decide el precio. |
| Ledger de costo | Generar variante con proveedor real/mock | Se registra `cost_ledger` con job, modelo, `operationKey`, `entryType` y version de precio; reintento no duplica cargo. |
| Reserva de presupuesto | Confirmar costo dentro del limite | `usage_meters.reservedValue` sube antes de crear jobs y baja al postear consumo real. |
| Presupuesto excedido | Confirmar costo que supera plan/credito | API bloquea antes de crear jobs y no llama proveedor. |
| Cancelacion con reserva | Cancelar lote antes de llamar IA | Reserva se libera y no queda consumo usado. |
| Webhook duplicado billing | Reenviar mismo evento Stripe/Mercado Pago | `billing_provider_events` ignora duplicado y no cambia dos veces entitlements. |
| Limite de plan | Superar fotos/variantes/posts del mes | API bloquea antes de crear jobs y muestra mensaje claro. |
| Structured Output invalido | Forzar respuesta IA incompleta/schema invalido | Job falla o reintenta segun perfil; no guarda datos inventados. |
| Prompt/modelo versionado | Generar variante | `Variant` referencia `aiRunId`, `modelProfileId`, `promptVersion` y `qualityCheckId`. |
| Prompt completo protegido | Revisar logs/DB tras generacion | No se guarda prompt completo ni base64 salvo modo debug temporal. |
| Prompt caching medible | Ejecutar varias captions con mismo perfil | `ai_runs.usage` registra `cachedTokens` cuando proveedor lo reporta. |
| Batch no interactivo | Ejecutar `batch_caption_eval` | Usa Batch/Flex solo para eval/reporte; no bloquea aprobacion en vivo. |
| Generar 1 variante | Confirmar | Variante generada con caption. |
| Generar 2 variantes | Confirmar | Dos variantes distintas. |
| Cancelar durante generacion | Cancelar | Lote cancelado, no trabajable. |
| Volver a home tras cancelar | Home | Lote cancelado no sale como activo. |

### Variantes

| Caso | Pasos | Esperado |
| --- | --- | --- |
| Imagen revision | Abrir approval | Imagen completa, sin recorte forzado. |
| Caption editable | Editar y guardar | Cambio persistente. |
| Aprobar | Tap aprobar | Variante aprobada y evento. |
| Rechazar | Tap rechazar | Variante rechazada y evento. |
| Repeticion visual | Generar varias | Estilos/angulos distintos por variante. |
| Quality gate bloquea | Simular imagen fuera de proporcion, MIME invalido o caption con claim inventado | Variante no puede aprobarse/publicarse y muestra razon segura. |
| Quality gate advierte | Simular persona visible, precio o logo sensible | Variante requiere revision humana; autopublicacion queda bloqueada. |
| Caption repetido | Generar captions con historial reciente similar | Caption service evita inicios/frases repetidas o marca warning. |
| Eval regresion prompt | Activar prompt canary peor que baseline | Eval/canary falla y no pasa a `active`. |
| Reabrir aprobacion | Antes de Meta | Vuelve a approval si no hay publicado. |
| Reabrir tras publicar | Despues de Meta | Bloqueado con mensaje. |

### Calendario

| Caso | Pasos | Esperado |
| --- | --- | --- |
| Confirmar calendario | Aprobar variantes -> calendario | Posts programados. |
| Editar fecha | Cambiar fecha/hora | Se guarda y se reordena. |
| Cancelar post | Cancelar programada | Estado cancelada. |
| Modo local por defecto | Confirmar calendario sin capability probe Meta | `deliveryMode=local_due_publish`, `remoteStatus=no_enviado`, job local pendiente. |
| Programacion remota habilitada | Capability probe exitoso y config activa | `deliveryMode=remote_schedule`, se guarda `facebookPostId`, `graphApiVersion` y `remoteStatus=confirmado_meta`. |
| Capability probe fallido | Probar pagina sin soporte/permiso suficiente | Se mantiene `local_due_publish` y se muestra warning interno, no bloqueo al usuario. |
| Editar/cancelar con Meta confirmado | Cambiar una publicacion con `facebookPostId` | Se sincroniza Meta o queda `estado_incierto`, nunca solo cambio local silencioso. |
| Editar/cancelar no enviado | Cambiar una publicacion con `remoteStatus=no_enviado` | Se actualiza localmente y se ajusta/cancela job pendiente sin llamar Meta. |
| Publicar ahora | Accion manual | Publicada o error claro. |
| Acceso Meta faltante | Publicar sin credenciales Meta validas | Pausada_por_token. |
| Retry fallida | Reintentar | Publica o mantiene error. |
| Retry post incierto | Reintentar `estado_incierto` | No publica hasta consultar/reconciliar Meta. |
| Worker caido y post vencido | Simular worker apagado hasta despues de `scheduledFor` | No publica tarde sin tolerancia; pasa a `needs_user_action` o fallida con mensaje claro. |
| URL publicable expirada | Meta intenta leer URL no accesible | Worker bloquea antes de llamar Meta o deja fallo seguro, no usa originales privados. |
| Cancelacion remota ambigua | Timeout tras `DELETE /{post-id}` | No marca `cancelada`; crea reconciliacion y muestra estado incierto. |
| Sync remoto | Ejecutar sync sobre post con `facebookPostId` | Actualiza `lastRemoteSyncAt`, estado remoto y permalink si existe. |

### Configuracion

| Caso | Pasos | Esperado |
| --- | --- | --- |
| Editar nombre | Settings | Persistente. |
| Editar industria | Settings | Afecta captions/prompts. |
| Editar SEO | Agregar keywords | Captions usan SEO natural. |
| Reset autonomia | Settings | Vuelve a umbrales base. |
| Crear estilo | Styles | Estilo aparece disponible. |
| Editar estilo | Styles | Cambios persistentes. |

### Metricas y reportes

| Caso | Pasos | Esperado |
| --- | --- | --- |
| Collect metrics exitoso | Post publicado con `facebookPostId` y permisos validos | Crea `post_metric_snapshots` por ventana y evento `metricas_recolectadas`. |
| Metrica Meta deprecada | Meta responde invalid metric | Job no falla completo; marca `MetricDefinition=deprecated/unavailable` y evento `metrica_no_disponible`. |
| Sin permisos de insights | Quitar permiso requerido o simular error Meta | Reporte degrada a datos propios y muestra confianza baja. |
| Ventanas comparables | Comparar posts de 24h y lifetime | UI/API no los mezcla en el mismo ranking. |
| Sample pequeno | Menos de 20 posts publicados | Home/reporte no afirma mejor horario/estilo; usa `confidence=exploratoria`. |
| Summary recalculable | Regenerar `performance_summaries` | Resultado se reconstruye desde eventos/snapshots sin depender de cache. |
| Reporte semanal | Ejecutar `weekly_report` | Incluye cobertura, fallas, costos IA, aprendizajes con confidence y proximas acciones. |

### Operacion y despliegue

| Caso | Pasos | Esperado |
| --- | --- | --- |
| Build productivo apunta a API correcta | Instalar APK/AAB productivo | `EXPO_PUBLIC_API_URL` usa HTTPS publico, nunca localhost ni staging. |
| Staging aislado | Ejecutar flujo completo en staging | No toca DB, Storage, tokens, webhooks ni paginas Meta de produccion. |
| Health publico | Consultar `/health` | Responde vivo sin filtrar secretos, clientes, versiones completas ni tokens. |
| Readiness falla | Simular DB/queue/config faltante | `/ready` falla y Render/operador no considera lista la instancia. |
| Worker heartbeat perdido | Detener worker | Alerta operativa; publicaciones automaticas riesgosas se pausan o bloquean. |
| Migracion incompatible | Probar migracion en staging con datos semilla | Falla antes de produccion o exige plan de rollback/backfill compatible. |
| Kill switch Meta | Apagar `FEATURE_META_PUBLISH` | Calendario sigue editable; no se llaman endpoints Meta de publicacion. |
| Kill switch OpenAI | Apagar `FEATURE_OPENAI_IMAGE_GENERATION` | No crea jobs costosos; contenido ya generado sigue revisable/programable. |
| Rollback API/worker | Volver a release anterior | No duplica publicaciones; revisa `external_operations` antes de reactivar worker. |
| Rollback OTA | Publicar update correctivo o rollback embedded compatible | Solo afecta builds del mismo `runtimeVersion`/canal esperado. |
| Source maps release | Provocar error controlado en build/update | Sentry muestra stack legible con ambiente, release, runtime/channel/update. |
| Restore dry-run | Restaurar backup en proyecto aislado | DB, migraciones, RLS, buckets y referencias `media_assets` quedan verificadas. |
| Storage faltante tras restore | Borrar/copiar metadata sin objeto | App muestra asset no disponible y no intenta publicar imagen inexistente. |
| Datos crudos ocultos | Revisar respuestas dashboard/performance | No expone payload bruto de Meta ni tokens; solo summaries sanitizados. |

### Produccion movil

| Caso | Pasos | Esperado |
| --- | --- | --- |
| APK sin PC | Abrir app con PC apagada | App conecta a Render. |
| API Render reiniciada | Abrir tras reinicio | Estado se lee desde DB y jobs pendientes se recuperan. |
| Build production | Revisar config | API_URL es HTTPS publico. |
| Build test | Revisar config | Puede usar local/LAN solo en test. |

## QA de seguridad

| Caso | Verificacion | Esperado |
| --- | --- | --- |
| `/meta/pages` | Inspeccionar respuesta | No hay pageAccessToken. |
| Error Meta | Forzar acceso Meta expirado | No se muestra token crudo. |
| Logs upload | Subir foto | No se imprime `imageDataUrl`. |
| Logs OpenAI | Generar | No se imprime API key ni base64. |
| Request tracing | Forzar error en generacion | UI muestra `requestId`; API, job y Sentry/logs comparten el mismo identificador. |
| Audit log sensible | Cambiar plan, conectar Meta o cancelar publicacion | Existe `audit_logs` sanitizado con actor, entidad y cambio permitido. |
| Alerta operativa | Simular job vencido o publicacion incierta | Se genera alerta/registro operativo sin duplicar side effects. |
| Session replay | Error movil con campos sensibles | Replay, si existe, enmascara texto, imagenes y datos de negocio por defecto. |
| APK | Buscar secretos | No hay OpenAI, service role, app secret. |
| Repo | Buscar `.env` real | No existe commit con secretos. |
| Rol viewer | Intentar generar/publicar como viewer | API responde 403 y no crea jobs. |
| Rol operator | Intentar conectar Meta o cambiar billing | API responde 403 y registra intento seguro. |
| RLS workspace | Intentar leer negocio de otro workspace | No retorna datos aunque se conozca el ID. |
| Storage original | Abrir URL directa de foto original | No es publica; solo signed URL temporal funciona. |
| Media publicable | Publicar variante aprobada | Solo asset aprobado se expone por URL legible para Meta. |
| URL Meta inaccesible | Simular URL publicable rota | Worker no llama Meta; post queda fallido accionable. |
| Privacy request | Solicitar export/eliminacion workspace | Solo owner puede; queda `privacy_requests` y `audit_logs`. |

## QA de proveedor IA

### Imagen

Criterios:

- Salida 1:1.
- Producto reconocible.
- No inventa logos.
- No modifica precios visibles.
- No tapa texto importante.
- No todas las variantes comparten el mismo estilo.
- Si proveedor limita lote, enviar 1 o 2 imagenes por llamada.

### Caption

Criterios:

- Maximo dos frases.
- Espanol natural.
- SEO integrado sin saturar.
- No repite la misma entrada.
- No inventa promociones.
- No abusa de emojis.
- Maximo 2 hashtags utiles.

### Vision

Criterios:

- Detecta sujeto.
- Detecta persona/precio/texto.
- Devuelve JSON valido.
- Falla de forma recuperable.

## Pruebas manuales antes de entregar APK

1. Instalar APK en Android.
2. Apagar servidor local de PC.
3. Abrir app.
4. Confirmar que conecta a Render.
5. Entrar a pagina real.
6. Revisar que no muestre publicaciones pausadas si token esta valido.
7. Crear lote con una foto.
8. Generar una variante.
9. Revisar imagen completa.
10. Aprobar.
11. Programar.
12. Cambiar fecha.
13. Cancelar una publicacion.
14. Crear segundo lote con dos variantes.
15. Revisar diversidad visual y de texto.

## Pruebas automatizables recomendadas

### Backend unitarias

- `getActiveBatch` excluye estados cerrados.
- `assertBatchCanBeWorked` bloquea cancelados.
- `generateVariants` asigna estilo por variante.
- `generateVariants` marca variante eliminada si lote se cierra.
- `listPages` no retorna page token.
- `publishScheduledPost` no duplica si ya hay `facebookPostId`.

### Backend integracion

- Upload -> vision -> foto validada.
- Confirm cost -> generate -> variants.
- Idempotency-Key repetida -> mismo job/respuesta.
- Approve -> calendar -> scheduled posts.
- Token missing -> paused by token.
- DB restore/restart y jobs pendientes se recuperan.

### Mobile

- `resolveInitialScreen`.
- API client maneja error sin crash.
- Approval screen usa contain/imagen completa.
- Botones disabled durante loading.
- Settings persiste metadata SEO.

## QA de comunicacion entre modulos

| Caso | Accion | Resultado esperado |
| --- | --- | --- |
| Sesion FBmaniaco | Abrir app instalada | Bootstrap valida usuario/sesion ligera antes de pedir Meta. |
| Seleccionar pagina | Elegir pagina en onboarding | Home recibe negocio activo sin pedir token ni page access token. |
| Reconectar Facebook | Acceso Meta expirado -> reconectar | Home y Calendario limpian/actualizan alertas de reconexion. |
| Crear lote | Desde Home tocar subir fotos | Lotes recibe `businessId` y crea batch `pending_upload`; Home refresca activeBatch. |
| Cancelar lote | Cancelar desde Home o Lotes | Lote deja de aparecer como trabajable en Home y Batch. |
| Generar variantes | Confirmar costo | Batch muestra progreso de jobs sin descargar tablas completas. |
| Aprobar variante | Swipe aprobar | Batch actualiza summary; Home refleja progreso. |
| Confirmar calendario | Programar 7/14/30 dias | Calendario muestra posts y Home deja de ofrecer lote como pendiente si corresponde. |
| Falla Meta | Publicar con acceso Meta vencido | Calendario marca `pausada_por_token`; Home muestra reconexion. |
| Cambiar SEO | Guardar keywords | Nuevos captions usan SEO; captions existentes no cambian solos. |
| Cambiar estilo | Editar catalogo | Nuevas variantes usan estilo actualizado; variantes ya publicadas conservan snapshot de estilo. |

Regla:

- Una pantalla no debe resolver por su cuenta contradicciones de estado. Si una respuesta viene incompleta o incompatible, debe mostrar error claro y pedir refresco.
- La app debe invalidar/refrescar solo queries afectadas por una mutacion: dashboard, batch detail, calendar range o job detail.
- Si se agrega Realtime/Broadcast para progreso de jobs, debe ser optimizacion visual; al volver a foco o terminar job siempre se consulta API.

### Query keys esperadas

| Query key | Pantallas | Se invalida cuando |
| --- | --- | --- |
| `bootstrap` | arranque, token, pages | cambia sesion, token Meta, pagina activa o workspace. |
| `pages` | onboarding/pages | se conecta/reconecta Meta o cambian permisos. |
| `dashboard:{businessId}` | Home | se crea/cancela lote, se programa calendario, falla token o termina job relevante. |
| `batch:{batchId}` | Lotes/aprobacion | upload, vision, generacion, aprobacion, rechazo, cancelacion o caption editado. |
| `jobs:{businessId}` | Home, Lotes, Calendario | se crea, avanza, falla, bloquea o completa un job. |
| `calendar:{businessId}:{range}` | Calendario, Home mini calendario | se confirma calendario, se publica, falla, reintenta, cancela o reprograma post. |
| `settings:{businessId}` | Configuracion | cambia SEO, autonomia, tipos de contenido o estilos. |

Regla de prueba:

- Cada mutacion debe declarar que query keys quedan obsoletas.
- Si una pantalla cambia por una mutacion y no hay invalidacion clara, el contrato de API esta incompleto.
- Si una pantalla necesita mas de dos lecturas para pintar su primer estado util, se debe crear o ampliar un endpoint agregado.

## Criterios de aceptacion por modulo

### Modulo 1

- El usuario puede conectar Meta.
- Puede seleccionar pagina.
- Puede reconectar si expira.
- No ve tokens internos.

### Modulo 2

- Home muestra estado real.
- Lote cancelado no aparece como activo.
- Alertas son accionables.

### Modulo 3

- Puede subir fotos.
- Puede generar variantes.
- Cada variante es visual/textualmente distinta.
- Puede aprobar/rechazar sin recortes de imagen.

### Modulo 4

- Puede programar.
- Puede editar fecha/hora.
- Puede cancelar.
- Puede publicar/reintentar.

### Modulo 5

- Puede editar SEO por pagina.
- Puede editar autonomia.
- Puede administrar estilos.

### Modulo 6

- Servicios IA internos usan memoria y autonomia.
- Jobs ejecutan vision, generacion, programacion y publicacion.
- Estilo por variante.
- Caption usa SEO.

### Modulo 7

- API cubre todas las rutas.
- DB primaria persiste fuera de PC.
- Jobs son idempotentes y recuperables.
- Errores son sanitizados.

### Modulo 8

- Render aloja API.
- APK apunta a API publica.
- Supabase/Postgres guarda DB primaria.
- Worker procesa jobs.

### Modulo 9

- Todas las integraciones estan inventariadas.
- Secretos clasificados.
- Nada sensible se muestra.

### Modulo 10

- Estados, tipos y tablas quedan cerrados.
- Reconstruccion no depende de leer codigo original.
- Usuarios/workspaces y jobs estan modelados.
- Planes/entitlements y costo IA tienen contratos suficientes para piloto y cobro futuro.
- DTOs usan nombres canonicos `camelCase`; DB usa `snake_case`.
- Entidades multi-tenant tienen `workspaceId` directo.
- Paginas Meta usan `metaPageId` externo y una pagina interna por workspace.
- Cambios de estado criticos generan evento reconstruible con `fromStatus`, `toStatus` y `reasonCode`.
- Subida de foto no persiste `uploadUrl` firmado como dato estable.

## Definicion de terminado

La app esta lista cuando:

- Se puede usar con la PC apagada.
- Se puede entrar desde APK.
- Puede controlar una pagina real sin mostrar tokens.
- Puede crear lote real.
- Puede generar variantes cuadradas.
- Puede aprobar con imagen completa.
- Puede programar/publicar.
- Puede recuperarse de acceso Meta expirado.
- Puede persistir tras reinicio de Render.
- Puede recuperar jobs pendientes tras reinicio.
- Los documentos explican como reconstruir todo desde cero.

