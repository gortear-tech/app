# Modulo 9 - APIs, integraciones y seguridad

Fecha de corte: 2026-05-08
Producto: FBmaniaco
Objetivo: documentar todas las APIs necesarias para reconstruir la app, desde las rutas basicas internas hasta las integraciones que controlan paginas de Facebook.

Este documento no contiene claves reales, tokens reales ni credenciales. Cualquier valor mostrado debe entenderse como nombre de variable o ejemplo conceptual.

## Principio general

FBmaniaco debe funcionar desde el celular, pero el celular no debe tener las llaves maestras del sistema.

La app movil puede conocer la URL publica de la API y datos visuales normales. Todo lo delicado debe vivir en el backend:

- Token de sesion FBmaniaco si aplica.
- Tokens de Meta.
- Tokens de paginas de Facebook.
- OpenAI API key.
- Supabase service role.
- Render API key.
- GitHub tokens.
- Expo/EAS tokens.
- Signed URLs temporales.
- Estado local con credenciales.

Regla central:

El celular pide acciones. El backend decide, valida, llama proveedores externos y guarda secretos.

## Modelo de permisos interno

Meta autoriza paginas; FBmaniaco autoriza usuarios y acciones. Son sistemas separados.

Roles:

| Rol | Puede |
| --- | --- |
| `owner` | Todo, incluyendo billing, miembros, exportacion/eliminacion y conexion Meta. |
| `admin` | Operar negocio, conectar/cambiar Meta e invitar operadores. No cambia billing ni elimina workspace. |
| `operator` | Subir fotos, generar, aprobar, programar, publicar y resolver fallas operativas. |
| `viewer` | Solo lectura. |

Reglas:

- Cada comando valida `workspaceId`, `actorId`, rol y estado comercial en backend.
- La UI puede ocultar botones, pero no cuenta como seguridad.
- Acciones de billing, miembros, conexion Meta, publicacion, cancelacion remota, exportacion y eliminacion requieren `audit_logs`.
- Un `owner` unico activo no puede eliminarse ni degradarse sin transferir propiedad.

## Comunicacion segura entre modulos

La comunicacion eficiente tambien debe ser segura:

- App movil recibe summaries/details sanitizados, nunca secretos.
- App movil usa sesion propia de FBmaniaco; Meta no sustituye identidad interna.
- API traduce errores de proveedores a `AppErrorResponse` con `userMessage`.
- Servicios internos de IA reciben contexto filtrado; no necesitan tokens, headers, URLs firmadas largas ni payloads crudos.
- Providers reciben secretos desde variables server-only y devuelven objetos normalizados.
- Worker usa los mismos secretos server-only que API y nunca abre una interfaz para el celular.
- Tablas, views y backups no deben exponer columnas con tokens ni prompts sensibles.

Regla de privacidad:

- Fotos originales y analisis de vision son privados.
- Variantes aprobadas que deben publicarse pueden exponerse mediante URL publica no enumerable o URL temporal compatible con Meta.
- El bucket publico no debe contener originales crudos ni assets rechazados.
- Las URLs firmadas deben tener TTL corto y no persistirse como fuente primaria.

Regla anti-fuga:

- Ningun modulo debe pasar datos sensibles "solo porque otro modulo podria necesitarlos". Si un consumidor no tiene una razon funcional directa, recibe ID, status o summary.

## Mapa de capas

### 1. App movil

Responsabilidad:

- Mostrar pantallas.
- Subir fotos.
- Pedir generacion de variantes.
- Aprobar o rechazar publicaciones.
- Configurar negocio, SEO y estilos.
- Ver calendario.
- Pedir publicacion o reintento.

Puede conocer:

- `API_URL` o `EXPO_PUBLIC_API_URL`.
- Token de sesion FBmaniaco guardado en Expo SecureStore.
- Nombre de la pagina.
- Foto o thumbnail publico de la pagina.
- Estado visible del token: `valido`, `expirado`, `requiere_reconexion`.
- Imagenes y captions ya generados para revision.
- Configuracion editable del negocio.

No debe conocer:

- `OPENAI_API_KEY`.
- `META_APP_SECRET`.
- `META_BOOTSTRAP_TOKEN`.
- User access token de Meta. El flujo manual de token solo puede existir como soporte/desarrollo controlado y no como onboarding productivo.
- Page access token.
- `SUPABASE_SERVICE_ROLE`.
- `RENDER_API_KEY`.
- `GITHUB_TOKEN`.
- `EXPO_TOKEN`.

### 2. API backend

Responsabilidad:

- Ser la unica puerta entre app movil y proveedores externos.
- Validar autorizacion y credenciales tecnicas de Meta.
- Obtener paginas.
- Guardar credenciales/page tokens solo backend, cifrados o en almacenamiento server-only equivalente.
- Crear lotes.
- Analizar imagenes.
- Generar variantes cuadradas para Facebook.
- Generar captions SEO.
- Programar calendario.
- Publicar en Facebook.
- Persistir estado.

Debe tener:

- Variables de entorno server-only.
- Logs sanitizados.
- Control de permisos de usuario.
- Validacion de sesion Supabase Auth o mecanismo equivalente.
- Separacion estricta entre usuario FBmaniaco y permisos Meta.
- Rate limit en rutas costosas.
- Proteccion especial para publicacion.
- Validacion server-side de plan, `billingStatus` y entitlements antes de acciones costosas.
- Reserva server-side de cupo/presupuesto antes de crear jobs que llamen proveedores.

### 3. Worker de publicaciones

Responsabilidad:

- Revisar publicaciones programadas.
- Publicar cuando llegue la hora.
- Marcar errores de token.
- Reintentar publicaciones.
- Guardar eventos de aprendizaje.

Debe usar los mismos secretos server-only. No debe exponer API publica al celular.

### 4. Proveedores externos

Responsabilidad:

- Meta Graph API: paginas, tokens, publicaciones y metricas.
- OpenAI API: vision, imagenes y captions.
- Supabase/Postgres: DB primaria, imagenes, backups privados y consultas operativas.
- Render: hosting de backend.
- Expo/EAS: build y distribucion movil.
- GitHub: repositorio y despliegue.

## Variables de entorno

### Server-only: nunca mostrar

Estas variables no deben aparecer en pantallas, respuestas JSON, capturas, logs normales, errores visibles, repositorio, APK ni documentos publicos.

| Variable | Para que sirve | Riesgo si se muestra |
| --- | --- | --- |
| `OPENAI_API_KEY` | Autoriza vision, imagenes y captions en OpenAI. | Cargos no autorizados y abuso de modelos. |
| `META_APP_SECRET` | Firma la app de Meta y permite validaciones avanzadas. | Robo de identidad de la app. |
| `META_BOOTSTRAP_TOKEN` | Token inicial para reconexion o pruebas controladas. | Acceso a paginas conectadas. |
| `META_ACCESS_TOKEN` | Alias historico de token de Meta. | Acceso a cuenta o paginas. |
| `META_USER_ACCESS_TOKEN` | Alias historico de token de usuario Meta. | Acceso a paginas del usuario. |
| `SUPABASE_SERVICE_ROLE` | Llave maestra de Supabase para Storage y REST. | Lectura/escritura total de datos. |
| `SUPABASE_JWT_SECRET` | Verificacion avanzada de tokens si aplica. | Falsificacion de sesiones si se filtra. |
| `DATABASE_URL` | Conexion a Postgres/Supabase DB primaria. | Acceso directo a base de datos. |
| `REDIS_URL` | Conexion a Redis/BullMQ. | Manipulacion de cola de jobs. |
| `PGMQ_QUEUE_ACCESS` | Acceso server-only a Supabase Queues si se usa API/funciones expuestas. | Manipulacion de cola de jobs. |
| `SESSION_SECRET` | Firma sesiones si se implementa login formal. | Robo o falsificacion de sesiones. |
| `PASSWORD_PEPPER` | Refuerzo de hashing de contrasenas. | Debilita contrasenas si se filtra. |
| `RENDER_API_KEY` | Administra servicios y variables en Render. | Control del servidor y secretos. |
| `GITHUB_TOKEN` | Acceso a codigo, acciones o deploy hooks. | Modificacion del repositorio. |
| `EXPO_TOKEN` | Acceso a builds y updates de Expo/EAS. | Publicacion de builds maliciosas. |
| `TOKEN_ENCRYPTION_KEY` | Cifra tokens Meta/page tokens si se guardan en DB. | Exposicion masiva de paginas conectadas. |
| `TOKEN_ENCRYPTION_KEY_ID` | Identifica version de llave activa para rotacion. | Facilita correlacion si se combina con filtracion. |

### Server config: no es necesariamente secreto, pero no debe mostrarse al usuario final

| Variable | Para que sirve |
| --- | --- |
| `HOST` | Host donde escucha la API. |
| `PORT` | Puerto interno de la API. |
| `NODE_ENV` | Ambiente: development o production. |
| `OPENAI_VISION_MODEL` | Modelo para analizar fotos. |
| `OPENAI_IMAGE_MODEL` | Modelo principal para generar variantes. |
| `OPENAI_IMAGE_FALLBACK_MODEL` | Modelo alterno si el principal no esta disponible. |
| `OPENAI_IMAGE_SIZE` | Tamano de salida, idealmente `1024x1024` para Facebook cuadrado. |
| `OPENAI_IMAGE_VARIANT_BATCH_SIZE` | Tamano maximo de lote para variantes. Debe mantenerse conservador, 1 o 2. |
| `OPENAI_IMAGE_TIMEOUT_MS` | Tiempo maximo para generar imagen. |
| `OPENAI_CAPTION_MODEL` | Modelo para captions SEO. |
| `OPENAI_BATCH_ENABLED` | Habilita Batch para procesos no urgentes. |
| `OPENAI_FLEX_ENABLED` | Habilita Flex para ahorro en procesos tolerantes a latencia. |
| `OPENAI_CAPTION_TIMEOUT_MS` | Tiempo maximo para captions. |
| `VISION_ANALYSIS_TIMEOUT_MS` | Tiempo maximo para analisis de vision. |
| `META_APP_ID` | ID publico de la app de Meta. Puede ser publico, pero no hace falta mostrarlo. |
| `META_REDIRECT_URI` | URI de redireccion OAuth si se usa login web. |
| `META_GRAPH_API_VERSION` | Version Graph API fijada explicitamente por ambiente. No usar llamadas sin version. |
| `META_DEVICE_LOGIN_SCOPES` | Permisos solicitados a Meta. |
| `SUPABASE_URL` | URL del proyecto Supabase. No es secreto, pero no debe mezclarse con service role. |
| `SUPABASE_STATE_BUCKET` | Bucket privado opcional para backups/export diagnostico. No es fuente primaria. |
| `SUPABASE_STATE_OBJECT` | Nombre opcional de backup de estado. |
| `SUPABASE_MEDIA_BUCKET` | Bucket de imagenes renderizables; publico solo para assets aprobados/publicables. |
| `DATABASE_URL` | Conexion a Postgres/Supabase DB primaria. |
| `MAX_UPLOAD_BODY_MB` | Limite de tamano para subida de imagenes. |

## Gestion de secretos

Reglas:

- Secretos largos viven en el gestor de secretos del hosting o en un vault; `.env` local solo desarrollo y nunca commit.
- Los tokens Meta/user/page persistidos deben cifrarse en aplicacion o guardarse en mecanismo server-only equivalente.
- Guardar `keyId`, `encryptedValue`, `createdAt`, `rotatedAt` y `lastUsedAt` para credenciales tecnicas persistidas.
- Rotar inmediatamente si un secreto aparece en logs, issue, screenshot, build, backup o dispositivo perdido.
- Rotacion programada minima: Meta tokens segun expiracion/debug, API keys por release mayor o incidente, encryption key con doble lectura durante migracion.
- Build secrets (`EXPO_TOKEN`, Sentry auth token, Render API key) solo en CI/hosting, nunca en APK.
- Las credenciales de proveedores se validan en arranque con checks de configuracion; si faltan, el servicio falla cerrado para acciones afectadas.
| `WORKER_MODE` | Modo del worker: idle, poll o bullmq. |
| `PUBLISH_BATCH_SIZE` | Numero de publicaciones a procesar por ciclo. |
| `ABANDONED_BATCH_SIZE` | Numero de lotes antiguos a revisar por ciclo. |

### Separacion de ambientes y rotacion

Reglas:

- `development`, `staging` y `production` usan secretos, DB, buckets, webhooks, tokens Meta y API keys OpenAI distintos.
- Ningun secreto de produccion puede copiarse a staging para "probar rapido".
- Staging debe usar paginas Meta de prueba/testers y datos sinteticos o anonimizados.
- Produccion no acepta `EXPO_PUBLIC_META_BOOTSTRAP_TOKEN`, tokens manuales de soporte ni URLs `localhost`.
- Cada secreto operativo debe tener owner, fecha de creacion, ultimo uso conocido y procedimiento de rotacion.
- Rotar `OPENAI_API_KEY`, `META_APP_SECRET`, `SUPABASE_SERVICE_ROLE`, `RENDER_API_KEY`, `EXPO_TOKEN`, `SENTRY_AUTH_TOKEN` y `TOKEN_ENCRYPTION_KEY` ante incidente o release mayor sensible.
- Para `TOKEN_ENCRYPTION_KEY`, soportar doble lectura: key activa para cifrar y keys anteriores solo para descifrar mientras se re-cifran credenciales.
- La rotacion debe poder hacerse sin rebuild movil cuando el secreto vive server-side.
- Los feature flags de seguridad viven server-side y deben evaluarse en API/worker, no solo en UI.

Flags operativos minimos:

| Flag | Uso |
| --- | --- |
| `FEATURE_META_PUBLISH` | Apaga publicaciones reales sin apagar calendario local. |
| `FEATURE_REMOTE_SCHEDULE` | Deshabilita programacion remota Meta y vuelve a scheduler propio. |
| `FEATURE_OPENAI_IMAGE_GENERATION` | Apaga generacion costosa si hay incidente/costos anormales. |
| `FEATURE_AUTONOMOUS_PUBLISH` | Apaga autonomia aun si el usuario habia dado opt-in. |
| `MAINTENANCE_MODE` | Permite modo lectura/degradado durante restore o incidente. |

### Mobile public: puede ir en build, con cuidado

| Variable | Para que sirve | Regla |
| --- | --- | --- |
| `API_URL` | URL publica HTTPS de la API en produccion. | Correcta para builds productivos. |
| `EXPO_PUBLIC_API_URL` | URL publica o local de API segun ambiente. | En produccion debe ser HTTPS publico, no localhost. |
| `EXPO_PUBLIC_META_APP_ID` | ID publico de app Meta si el cliente inicia OAuth. | No incluir secret. |
| `EXPO_PUBLIC_META_REDIRECT_URI` | Redirect URI del flujo movil. | Debe coincidir con Meta config. |
| `EXPO_PUBLIC_SUPABASE_URL` | URL Supabase si la app usa Supabase directo. | Solo con RLS bien configurado. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Llave anonima Supabase. | Nunca usar service role en el celular. |
| `EXPO_PUBLIC_META_BOOTSTRAP_TOKEN` | Token de prueba para desarrollo. | Debe estar vacio en produccion. |

Regla movil:

- Si la app consume Supabase Auth directo, solo puede usar anon key y RLS.
- Para el MVP recomendado, la app habla principalmente con API Fastify; Supabase Auth puede usarse para obtener sesion y la API valida esa sesion.
- Expo SecureStore guarda solo sesion/local flags pequenos. Nunca guardar page access token de Meta.

## APIs internas de FBmaniaco

Estas rutas viven en la API Fastify. La app movil habla con estas rutas, no directamente con OpenAI ni Meta.

En reconstruccion productiva, todas las rutas excepto `/health` deben requerir sesion del dueno o token interno de app. La version actual esta orientada a un solo dueno y debe endurecerse antes de operar como multiusuario.

### Salud y sesion

| Metodo | Ruta | Para que sirve | Seguridad |
| --- | --- | --- | --- |
| `GET` | `/health` | Health check para Render. | Puede ser publica. No debe exponer version, variables ni estado. |
| `GET` | `/auth/bootstrap-status` | Indica si falta conectar Meta, seleccionar pagina o si la app esta lista. | No devolver tokens. |
| `POST` | `/auth/meta/connect` | Inicia/continua autorizacion oficial de Meta: Facebook Login/OAuth, Login for Business si aplica, o device login solo si esta soportado. | No recibe tokens manuales. No revelar bootstrap token ni credenciales tecnicas. |
| `POST` | `/auth/meta/callback` | Completa intercambio OAuth/device login y guarda credenciales tecnicas. | Body sensible. No loguear. Guardar solo backend, cifrado o server-only, y no devolver token. |
| `POST` | `/auth/meta/refresh` | Refresca credenciales tecnicas server-side y actualiza paginas/status. | No devolver tokens. Sanitizar errores de Meta. |
| `POST` | `/auth/meta-token/support` | Procesa token manual solo para soporte/desarrollo controlado. | Deshabilitado por defecto en produccion. No loguear body. No devolver token. |
| `POST` | `/auth/logout` | Cierra sesion local. | Debe limpiar almacenamiento local del celular. |
| `GET` | `/me` | Devuelve usuario local/dueno. | No incluir secretos ni permisos internos. |

### Control de paginas Meta/Facebook

| Metodo | Ruta | Para que sirve | Seguridad |
| --- | --- | --- | --- |
| `GET` | `/meta/pages` | Lista paginas conectadas disponibles para elegir. | Devuelve solo `pageId`, `pageName`, `coverPhotoUrl`, `category`, `tasks`, `isSelected`, `pageAccessTokenStatus`. Nunca `pageAccessToken`. |
| `POST` | `/meta/pages/select` | Selecciona una pagina y crea/activa el negocio vinculado. | Recibe `pageId`. Debe validar que esa pagina pertenece al token conectado. |

Contrato visible de pagina:

```ts
type PageSummary = {
  pageId: string;
  pageName: string;
  coverPhotoUrl?: string | null;
  category?: string | null;
  tasks?: string[] | null;
  pageAccessTokenStatus?: "valido" | "expirado" | "requiere_reconexion";
  isSelected: boolean;
};
```

Campos prohibidos en respuestas al celular:

- `pageAccessToken`.
- User access token.
- App access token.
- Token debug details completos.
- Errores crudos de Meta que contengan token.

### Estilos visuales

| Metodo | Ruta | Para que sirve | Seguridad |
| --- | --- | --- | --- |
| `GET` | `/styles` | Lista estilos visuales disponibles. | Puede mostrarse al dueno. |
| `POST` | `/styles` | Crea un estilo visual nuevo. | Validar texto, evitar prompts maliciosos si multiusuario. |
| `PATCH` | `/styles/:styleId` | Edita un estilo. | No permitir editar estilos de otro negocio si hay multiusuario. |
| `DELETE` | `/styles/:styleId` | Elimina un estilo. | No borrar estilos usados sin manejo de referencias. |

### Negocios y configuracion SEO

| Metodo | Ruta | Para que sirve | Seguridad |
| --- | --- | --- | --- |
| `GET` | `/businesses` | Lista negocios/paginas conectadas. | No incluir tokens de paginas. |
| `POST` | `/businesses` | Crea negocio desde pagina seleccionada. | Debe validar `pageId`. |
| `GET` | `/businesses/:businessId` | Devuelve detalle del negocio. | SEO y metadata son visibles solo al dueno. |
| `PATCH` | `/businesses/:businessId` | Actualiza nombre, industria, tono, autonomia, SEO y metadata. | Validar tamano y contenido. No permitir cambiar `facebookPageId` a una pagina no conectada. |
| `GET` | `/businesses/:businessId/dashboard` | Devuelve resumen, alertas, lotes y posts recientes. | Alertas deben ser sanitizadas. |

Datos SEO esperados en metadata:

```ts
type FacebookSeoConfig = {
  keywords: string[];
  context?: string | null;
};
```

Uso:

- `keywords` alimenta el caption.
- `context` da instrucciones sobre busqueda local, productos, zonas, intencion o frases clave.
- No debe convertirse en texto repetitivo ni keyword stuffing.

### Lotes de publicaciones

| Metodo | Ruta | Para que sirve | Seguridad |
| --- | --- | --- | --- |
| `POST` | `/businesses/:businessId/batches` | Crea lote nuevo. | Un solo lote activo por negocio o reglas claras de concurrencia. |
| `POST` | `/businesses/:businessId/batches/:batchId/cancel` | Cancela lote. | Debe cerrar lote y bloquear trabajo futuro si no llego a Meta. |
| `GET` | `/businesses/:businessId/batches` | Lista lotes. | No incluir prompts completos si no son necesarios en UI. |
| `GET` | `/businesses/:businessId/batches/active` | Devuelve lote activo. | No devolver lotes cancelados como trabajables. |
| `GET` | `/businesses/:businessId/batches/:batchId` | Devuelve detalle del lote. | Revisar que imagenes tengan URLs renderizables y seguras. |

Regla de cancelacion:

- Estados cerrados: `completado`, `cancelado`, `fallido`, `abandonado`.
- Un lote cerrado no debe aceptar upload, generacion, aprobacion, calendario ni reintentos.
- Si una variante esta generandose y el lote se cancela, debe marcarse como `eliminada` o no trabajable.

### Subida y analisis de fotos

| Metodo | Ruta | Para que sirve | Seguridad |
| --- | --- | --- | --- |
| `POST` | `/businesses/:businessId/batches/:batchId/photos/upload-intent` | Prepara una subida de foto y devuelve `uploadUrl`/`storageKey`. | `uploadUrl` puede ser temporal. No loguear ni guardar en lugares publicos si es firmado. |
| `POST` | `/businesses/:businessId/batches/:batchId/photos/complete-upload` | Confirma foto subida, guarda referencia y dispara analisis de vision. | Produccion recibe `storageKey` y metadata. `imageDataUrl` solo fallback; no loguear porque puede contener la imagen completa. |

Datos sensibles:

- `imageDataUrl` puede ser grande y privado.
- `storageKey` identifica objetos internos.
- `visionAnalysis` puede contener informacion sensible si aparece una persona, precio o texto.

Regla de upload:

- La ruta profesional es subida directa binaria a Storage mediante signed URL temporal.
- La app no debe mandar base64/data URL a la API en produccion salvo fallback controlado.
- `upload-intent` debe limitar content type, tamano, workspace, business y vencimiento.
- `complete-upload` debe verificar que el objeto existe, pertenece al workspace/negocio y cumple metadata esperada antes de crear job.

Politica minima de privacidad de media:

- Guardar originales solo el tiempo necesario para generar, auditar y permitir reintentos razonables.
- Definir retencion por negocio: por ejemplo `originalMediaRetentionDays` y `generatedMediaRetentionDays`.
- Permitir borrar originales de lotes cerrados sin borrar necesariamente posts ya publicados.
- No usar fotos de un negocio para entrenar preferencias de otro workspace.
- Si una foto contiene personas, precios, documentos, menores o texto sensible, elevar riesgo y evitar autonomia de publicacion.
- Soportar exportacion/eliminacion de datos por workspace antes de operar comercialmente con multiples clientes.

### Costos y generacion de variantes

| Metodo | Ruta | Para que sirve | Seguridad |
| --- | --- | --- | --- |
| `POST` | `/businesses/:businessId/batches/:batchId/estimate-cost` | Calcula costo estimado segun fotos, variantes, proveedor, modelo y reglas de pricing vigentes. | No confiar en costo enviado por cliente. |
| `POST` | `/businesses/:businessId/batches/:batchId/confirm-cost` | Confirma costo, version de precio y desglose antes de generar. | Requiere aprobacion del usuario y registra actor/version. |
| `POST` | `/businesses/:businessId/batches/:batchId/generate` | Genera variantes visuales y captions SEO. | Ruta costosa. Debe tener rate limit, cancelacion y control de lote. |
| `GET` | `/businesses/:businessId/batches/:batchId/variants` | Lista variantes generadas. | Se pueden mostrar imagen, caption y warnings seguros. Nunca exponer prompt completo; usar solo `aiRunId`, version y quality summary si hace falta. |
| `POST` | `/businesses/:businessId/batches/:batchId/variants/reopen-approval` | Reabre aprobacion de variantes si aun no llego a Meta. | No permitir si ya hay posts publicados o en Meta. |
| `PATCH` | `/businesses/:businessId/batches/:batchId/variants/:variantId/caption` | Edita caption manualmente. | Validar longitud y limpiar caracteres no deseados. |
| `POST` | `/businesses/:businessId/batches/:batchId/variants/:variantId/approve` | Aprueba variante. | Registrar evento de aprendizaje. |
| `POST` | `/businesses/:businessId/batches/:batchId/variants/:variantId/reject` | Rechaza variante. | Registrar evento de aprendizaje. |

Regla importante:

- El estilo se asigna por variante, no por foto.
- `confirm-cost` debe bloquear con transaccion/row lock el periodo en `usage_meters`.
- Ningun job de IA debe llamar proveedor si no hay reserva o si la reserva fue liberada/cancelada.
- Webhooks de billing se verifican por firma y se guardan en `billing_provider_events` antes de modificar plan/entitlements.
- Cada variante debe tener `styleId`, `styleName` y `assignedStyle`.
- La IA debe recibir instrucciones de diferenciacion por variante.
- La imagen final debe ser cuadrada, ideal para Facebook post: `1024x1024`.

### Calendario y publicaciones

| Metodo | Ruta | Para que sirve | Seguridad |
| --- | --- | --- | --- |
| `POST` | `/businesses/:businessId/batches/:batchId/calendar/confirm` | Convierte variantes aprobadas en posts programados. | Debe validar periodo permitido: 7, 14 o 30 dias. |
| `GET` | `/businesses/:businessId/scheduled-posts` | Lista publicaciones programadas del negocio. | No devolver token ni payload crudo de Meta. |
| `GET` | `/businesses/:businessId/batches/:batchId/scheduled-posts` | Lista publicaciones de un lote. | Solo del negocio correspondiente. |
| `PATCH` | `/businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId` | Cambia fecha/hora. | Validar zona horaria y que no este publicada/cancelada. |
| `POST` | `/businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId/cancel` | Cancela una publicacion programada. | Si ya fue publicada en Meta, no fingir cancelacion local. |
| `POST` | `/businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId/publish` | Publica manualmente ahora. | Accion de alto riesgo. Debe pedir confirmacion. |
| `POST` | `/businesses/:businessId/batches/:batchId/scheduled-posts/:scheduledPostId/retry` | Reintenta publicar tras error. | Si el error fue token, pedir reconexion primero. |

Estados recomendados:

- `pendiente`.
- `programada`.
- `publicacion_en_proceso`.
- `publicada`.
- `estado_incierto`.
- `fallida`.
- `pausada_por_token`.
- `cancelada`.

## Meta Graph API

Meta Graph API es la integracion que controla paginas. Todas estas llamadas deben hacerse desde backend o worker.

### Permisos necesarios

| Permiso | Para que sirve |
| --- | --- |
| `pages_show_list` | Listar paginas que administra el usuario. |
| `pages_read_engagement` | Leer informacion basica e insights/engagement de paginas y posts. |
| `pages_manage_posts` | Crear, programar o publicar posts en paginas. |
| `pages_manage_metadata` | Opcional si se usan webhooks/subscriptions o gestion avanzada de metadata. |
| `business_management` | Opcional. Evaluar solo si Login for Business/Business Manager lo exige para operar activos; no pedir sin uso demostrable. |

Reglas Meta:

- Todas las llamadas Graph deben usar `META_GRAPH_API_VERSION`.
- Antes de operar con clientes externos, la app debe pasar App Review y Business Verification si Meta lo exige para permisos avanzados.
- El flujo de permisos debe pedir solo los scopes implementados y demostrables.
- Mantener registro de `grantedScopes`, `declinedScopes`, `missingRequiredScopes`, `grantedPageIds`, `tokenExpiresAt`, `lastDebugAt`, `appMode`, `appReviewStatus` y `graphApiVersion` por autorizacion.
- No confiar solo en scopes globales: Meta puede aplicar permisos granulares por pagina. Cada pagina debe validarse como concedida antes de seleccionarla o publicar.
- Workspaces externos no pueden publicar si la app sigue en development mode o si permisos requeridos no tienen App Review aprobado.
- Usar `/debug_token` periodicamente o al fallar Meta para distinguir credencial vencida, permisos revocados y pagina no disponible.
- Usar `appsecret_proof` en llamadas server-side cuando aplique para reducir riesgo de abuso de tokens.
- Si una pagina pierde permiso granular, detener jobs de publicacion de esa pagina y pedir reconexion.
- No usar tokens de una pagina para operar otra, aunque pertenezcan al mismo usuario Meta.

### Credenciales Meta

| Credencial | Uso | Seguridad |
| --- | --- | --- |
| `META_APP_ID` | Identifica la app en Meta. | Puede ser publico, pero no hace falta mostrarlo. |
| `META_APP_SECRET` | Permite validar y renovar tokens. | Nunca mostrar. Solo backend. |
| User access token | Token del usuario administrador. | No mostrar. No guardar en el celular en produccion endurecida. |
| Page access token | Token especifico de cada pagina. | Nunca mostrar. Es el mas delicado para publicar. |
| App access token | Formato `appId|appSecret`. | Nunca mostrar. |

### Llamadas usadas

| Metodo | Graph path | Para que sirve | Datos sensibles |
| --- | --- | --- | --- |
| `GET` | `/debug_token` | Validar si un token es real y vigente. | `input_token`, `appAccessToken`. |
| `GET` | `/me/accounts` | Listar paginas y obtener page access token. | User token, page access token. |
| `GET` | `/oauth/access_token` | Convertir token corto a token largo. | App secret y token de usuario. |
| `POST` | `/device/login` | Iniciar login por dispositivo. | App access token. |
| `POST` | `/device/login_status` | Intercambiar device code por user token. | Device code y user token resultante. |
| `POST` | `/{pageId}/photos` | Publicar imagen en pagina. | Page token, imagen, caption. |
| `POST` | `/{pageId}/feed` | Publicar texto/feed en pagina. | Page token, caption. |
| `GET` | `/{pageId}/scheduled_posts` o edge vigente equivalente | Leer posts programados si la version Graph/pagina lo soporta. | Page token, agenda. |
| `GET` | `/{postId}` | Reconciliar existencia/estado/permalink. | Page token, post id. |
| `GET` | `/{postId}/insights` o endpoint vigente de Insights | Obtener metricas de post cuando existan. | Page token, metricas de rendimiento. |
| `POST` | `/{page-post-id}` | Editar mensaje de post cuando Meta lo permita. | Page token, post id. |
| `DELETE` | `/{page-post-id}` | Eliminar/cancelar post cuando Meta lo permita. | Page token, post id. |

Regla de publicacion:

- Para posts con imagen, preferir `/{pageId}/photos` cuando se publique una imagen como post de pagina.
- Para texto/enlaces/feed, usar `/{pageId}/feed`.
- El modo base recomendado es `local_due_publish`: DB agenda y worker publica al llegar la hora.
- Si se programa en Meta (`remote_schedule`), enviar parametros de programacion compatibles con Graph API vigente, guardar `facebookPostId`, `graphApiVersion`, `scheduledAtUnix` y marcar `remoteStatus = confirmado_meta`.
- `remote_schedule` requiere capacidades probadas en `meta_publishing_capabilities`; sin prueba vigente, volver a modo local.
- Si Meta no permite editar/cancelar un objeto ya programado, la estrategia debe ser cancelar/recrear de forma idempotente o dejar `estado_incierto`; nunca modificar solo DB.
- Guardar `fbtrace_id` solo como `remoteTraceId`/log sanitizado, no como mensaje visible al usuario.

### Flujo correcto para paginas

1. El usuario toca conectar Facebook.
2. Meta muestra autorizacion oficial: Facebook Login/OAuth, Login for Business si aplica, o device login solo si esta soportado.
3. Backend recibe y valida la credencial tecnica entregada por Meta.
4. Backend intenta renovar a long-lived token si tiene `META_APP_ID` y `META_APP_SECRET`.
5. Backend llama `/me/accounts`.
6. Backend calcula `missingRequiredScopes` y `grantedPageIds`.
7. Backend guarda `MetaAuthorization`.
8. Backend guarda cada `pageAccessToken` server-side y cifrado/protegido.
9. App movil recibe solo resumen de paginas y advertencias de permisos.
10. Usuario selecciona pagina.
11. Backend valida que la pagina fue concedida y tiene permisos/tareas suficientes.
12. Backend crea negocio con `facebookPageId`.
13. Cuando se publica, backend/worker usa `pageAccessToken`.
14. Si Meta responde error de token/permisos, el post queda `pausada_por_token` o `fallida/error_permiso` y la app pide reconexion.

### Lo que jamas debe mostrar la app

- Token pegado manualmente.
- Page access token.
- Resultado completo de `/me/accounts`.
- App secret.
- App access token.
- Request URL completa si contiene `access_token`.
- Errores crudos de Meta con query string.

Regla de producto:

- La app no debe presentar "pegar token" como camino normal. Si existe, debe estar oculto detras de modo soporte/desarrollo, con copy claro de riesgo y sin persistencia en el celular.

## OpenAI API

OpenAI se usa para tres tareas:

- Analizar foto original.
- Crear variante visual cuadrada.
- Escribir caption SEO para Facebook.

Todas las llamadas deben salir del backend.

### Credenciales OpenAI

| Variable | Uso | Seguridad |
| --- | --- | --- |
| `OPENAI_API_KEY` | Autoriza todas las llamadas a OpenAI. | Nunca mostrar. Nunca meter en APK. |
| `OPENAI_VISION_MODEL` | Modelo de vision. | Config interna. |
| `OPENAI_IMAGE_MODEL` | Modelo de imagen. | Config interna. |
| `OPENAI_CAPTION_MODEL` | Modelo de caption. | Config interna. |

### Endpoints usados

| Metodo | Endpoint | Para que sirve | Seguridad |
| --- | --- | --- | --- |
| `POST` | `https://api.openai.com/v1/responses` | Analisis de vision con imagen y captions estructurados. | Header `Authorization` secreto. No loguear prompt completo si incluye info de negocio. |
| `POST` | `https://api.openai.com/v1/images/edits` | Generar variante usando foto fuente. | Header secreto e imagen fuente privada. |
| `POST` | `https://api.openai.com/v1/images/generations` | Generar imagen sin foto fuente si aplica. | Header secreto y prompt interno. |

### Contrato de vision

La vision debe devolver JSON estructurado:

- `schemaVersion`.
- `subject`: tipo, descripcion, si hay persona.
- `composition`: encuadre, angulo, fondo, luz.
- `palette`: colores, temperatura, saturacion, contraste.
- `sensitiveElements`: precio, logo, persona, promocion, texto.
- `technicalQuality`: nitidez, exposicion, ruido.
- `mood`: tono visual.
- `summary`: resumen.

Seguridad:

- Si hay persona visible, precio visible o texto sensible, el sistema debe elevar cuidado.
- No mostrar analisis completo a clientes finales salvo modo tecnico.
- No usar analisis para publicar datos sensibles no aprobados.

### Contrato de imagen

La generacion debe:

- Mantener el producto real.
- Crear corte cuadrado Facebook.
- Hacer variantes diferentes entre si.
- Asignar estilo por variante.
- Evitar que todas las fotos salgan con mismo look.
- Usar lotes pequenos, ideal 1 o 2 por llamada segun capacidad del proveedor.

Datos no visibles:

- Prompt completo/debug payload.
- `ai_runs.inputHash` si no aporta valor al usuario.
- `generationPlan` completo.
- Lista de modelos fallback.
- Errores crudos de proveedor.

### Contrato de captions SEO

El caption debe:

- Estar en espanol.
- Ser natural para Facebook.
- Incluir SEO de pagina sin forzarlo.
- Usar 0 a 2 hashtags utiles.
- Evitar repetir inicios y cierres.
- Evitar frases genericas repetidas.
- Diferenciarse por variante.

Contrato tecnico:

- Usar Structured Outputs con schema versionado, no pedir "devuelve JSON" solo en prompt.
- Mantener contenido estable de prompts al inicio y contexto variable al final para aprovechar prompt caching.
- Guardar `modelProfileId`, `schemaVersion`, `promptVersion`, `responseId` si aplica, `usage` sanitizado, `cachedTokens`, `requestId` y `aiRunId` en job/result o ledger tecnico.
- Para flujos con privacidad estricta o Zero Data Retention, no depender de estado remoto; reenviar contexto necesario de forma explicita.

Datos visibles:

- Caption final editable.

Datos ocultos:

- Prompt completo.
- Keywords internas si el usuario decide ocultarlas.
- Captions recientes usados para evitar repeticion.

## Supabase APIs

Supabase se usa para DB primaria, Storage y backups privados opcionales.

### Credenciales

| Variable | Uso | Seguridad |
| --- | --- | --- |
| `SUPABASE_URL` | URL base del proyecto. | No es secreto, pero no basta para entrar. |
| `SUPABASE_SERVICE_ROLE` | Llave maestra. | Nunca mostrar. Solo backend/worker. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Llave anonima si la app consulta directo. | Solo con RLS. Nunca sustituye service role. |

### Storage

| Metodo | Endpoint | Para que sirve | Seguridad |
| --- | --- | --- | --- |
| `POST` | `/storage/v1/bucket` | Crear bucket si no existe. | Requiere service role. Backend only. |
| `GET` | `/storage/v1/object/{bucket}/{object}` | Descargar backup privado opcional. | Requiere service role. No publico. |
| `PUT` | `/storage/v1/object/{bucket}/{object}` | Subir backup privado opcional. | Requiere service role. |
| `PUT` | `/storage/v1/object/{bucket}/{key}` | Subir imagen original, generada o derivado. | Requiere service role o signed upload token emitido por API. |
| `GET` | `/storage/v1/object/public/{mediaBucket}/{key}` | URL publica renderizable de imagen aprobada/publicable. | Solo para media publicable. |
| `HEAD/GET` | URL publicable | Validar acceso antes de Meta. | No usar originales privados. |

Buckets:

- `SUPABASE_STATE_BUCKET`: privado, backup opcional. No publico.
- `SUPABASE_ORIGINALS_BUCKET`: privado para fotos originales del usuario.
- `SUPABASE_GENERATED_BUCKET`: privado por defecto para variantes no aprobadas.
- `SUPABASE_MEDIA_BUCKET`: publico o CDN controlado solo para imagenes aprobadas/publicables que Facebook necesita leer por URL.

Reglas de Storage:

- Upload directo siempre escribe primero en bucket privado con signed URL de TTL corto.
- El worker copia o transforma a media publicable solo cuando la variante/post fue aprobado.
- Keys de media deben ser no enumerables y scoped por workspace.
- No usar buckets publicos para originales, assets rechazados, backups o data URLs.
- Borrado de workspace debe borrar o anonimizar objetos de Storage segun retencion configurada.
- Usar Sharp/libvips para normalizar orientacion, quitar EXIF sensible, generar thumbnails y convertir a formatos compatibles cuando sea necesario.
- Registrar cada objeto y derivado en `media_assets`.

### Postgres/REST DB primaria

| Tabla | Para que sirve | Riesgo |
| --- | --- | --- |
| `users` | Usuarios internos. | Datos de acceso. |
| `workspaces` | Espacios de trabajo. | Permisos y propiedad. |
| `billing_accounts` / entitlements | Estado comercial y limites. | Puede revelar plan, deuda o relacion comercial. |
| `facebook_pages` | Paginas conectadas. | No debe exponer `page_access_token`. |
| `meta_publishing_capabilities` | Capacidades probadas de publicacion por pagina/version Graph. | Puede revelar fallos operativos; no contiene tokens. |
| `businesses` | Negocios/paginas y metadata. | Contiene SEO y autonomia. |
| `batches` | Lotes y conteos. | Puede mostrar actividad interna. |
| `photos` | Fotos, estado y analisis. | Puede contener imagenes y vision sensible. |
| `variants` | Variantes, prompts, captions e imagenes. | Puede contener estrategia creativa. |
| `model_profiles` / `prompt_templates` | Configuracion versionada de modelos/prompts. | Puede revelar estrategia de IA; no debe exponer datos de clientes. |
| `ai_runs` | Auditoria de llamadas IA con hashes/uso/costo. | Puede revelar patrones internos; no debe guardar prompt completo, base64 ni respuestas crudas. |
| `ai_quality_checks` / `ai_evaluations` | Calidad, warnings y evals de IA. | Puede revelar fallos internos y criterios de producto. |
| `scheduled_posts` | Calendario, captions, estado y postId. | Puede revelar agenda de publicaciones. |
| `metric_definitions` | Catalogo de metricas proveedor/canonicas. | Puede revelar adaptacion ante cambios de Meta. |
| `post_metric_snapshots` | Valores recolectados por post/ventana. | Puede revelar rendimiento comercial. |
| `performance_summaries` | Agregados por semana, estilo, horario y caption. | Puede revelar estrategia y aprendizaje del negocio. |
| `jobs` | Trabajos asincronos. | Puede contener payload interno. |
| `job_attempts` | Intentos de ejecucion. | Puede revelar errores/proveedores. |
| `external_operations` | Side effects externos. | Puede revelar IDs externos y estado operativo. |
| `outbox_events` | Eventos internos pendientes. | Puede revelar flujo operativo. |
| `events` | Auditoria y aprendizaje. | Puede revelar decisiones. |

Endpoint usado:

```txt
POST {SUPABASE_URL}/rest/v1/{table}?on_conflict={key}
```

Headers:

- `apikey: SUPABASE_SERVICE_ROLE`
- `Authorization: Bearer SUPABASE_SERVICE_ROLE`
- `Content-Type: application/json`
- `Prefer: resolution=merge-duplicates,return=minimal`

Regla:

La DB es fuente primaria. La service role nunca debe usarse desde el celular. Si se decide consultar Supabase directo desde la app, debe existir RLS por usuario/workspace/negocio y la app debe usar solo anon key.

Modelo recomendado:

- MVP: app movil habla con API Fastify; API/worker usan service role o conexion DB server-side.
- Aun con API como unica puerta, RLS queda habilitado como defensa en profundidad.
- Si en el futuro la app consulta Supabase directo, solo puede leer views/RPC sanitizadas sin columnas secretas.
- `anon` no debe tener acceso a tablas de negocio.
- `authenticated` solo ve filas de workspaces donde existe `workspace_members.status = active`.
- `WITH CHECK` debe impedir insertar/actualizar filas hacia un `workspace_id` ajeno.
- `service_role` no reemplaza validaciones de dominio; cada comando valida actor, rol, workspace y estado.

Integridad obligatoria:

- RLS habilitado en tablas del schema expuesto si Supabase queda accesible por roles `anon`/`authenticated`.
- Foreign keys internas para evitar referencias huerfanas.
- Unique indexes para `workspace_id + meta_page_id`, idempotencia, jobs activos y `facebook_post_id` no nulo.
- CHECK constraints o enums compartidos para estados criticos cuando la primera migracion estable este cerrada.
- Views/DTOs sanitizados para cualquier lectura desde cliente; nunca `select *` de tablas con secretos.

Regla de Supabase Queues/PGMQ:

- Los consumidores server-side deben leer mensajes con visibility timeout.
- Al completar correctamente, archivar o eliminar el mensaje.
- Si falla, dejar que reaparezca o marcar job como `failed`, `blocked` o `needs_user_action` segun causa.
- No exponer funciones PGMQ publicas al cliente movil.

## Render APIs y hosting

Render aloja el backend publico.

### Lo que necesita Render

- Servicio web Docker.
- Health check en `/health`.
- Variables de entorno server-only.
- Conexion DB estable.
- Worker activo si hay jobs de IA/publicacion.
- Deploy conectado a GitHub o manual.

### Variables Render criticas

Render debe guardar como secret/sync false:

- `OPENAI_API_KEY`.
- `META_APP_ID`.
- `META_APP_SECRET`.
- `META_BOOTSTRAP_TOKEN`.
- `SUPABASE_URL`.
- `SUPABASE_SERVICE_ROLE`.

### Render API key

Si se automatiza Render desde scripts, se puede usar una API key de Render.

Reglas:

- Nunca va en app movil.
- Nunca va en repo.
- Nunca se documenta en texto visible.
- Nunca se pega en screenshots.
- Solo se usa en maquina o automation segura.
- Si se filtra, se revoca de inmediato.

## Expo/EAS APIs

Expo/EAS se usa para compilar APK/AAB y distribuir builds.

### Datos no secretos

- App name: `FBmaniaco`.
- Package Android: `com.gabriel.fbmaniaco`.
- EAS project id.
- Version y versionCode.
- Runtime channel: `production` o `test`.

### Secretos

| Variable | Para que sirve | Seguridad |
| --- | --- | --- |
| `EXPO_TOKEN` | Permite ejecutar builds o updates en EAS sin login interactivo. | Nunca mostrar. |
| Keystore Android | Firma releases Android. | Nunca subir al repo si no esta cifrado. |
| Credenciales Apple | Builds iOS si se activa. | Nunca mostrar. |

### Regla de build productiva

La app de produccion debe compilarse con:

```txt
API_URL=https://fbmaniaco-api.onrender.com
```

o la URL publica equivalente de Render.

No debe compilarse con:

- `localhost`.
- `127.0.0.1`.
- IP LAN de la PC.
- `EXPO_PUBLIC_META_BOOTSTRAP_TOKEN` con valor real.

## GitHub APIs y repositorio

GitHub no es parte del runtime diario, pero es necesario para reconstruccion y despliegue.

Usos:

- Guardar codigo.
- Conectar Render a deploy automatico.
- Hacer branches, commits y pull requests.
- Ejecutar CI si se agrega.

Secretos posibles:

- `GITHUB_TOKEN`.
- Deploy keys.
- Webhook secrets.

Reglas:

- Nunca guardar `.env` real.
- Nunca guardar backups/exportaciones si contienen tokens.
- Nunca guardar keystores sin cifrado.
- Revisar commits antes de push si se tocaron archivos de datos.

## Redis/BullMQ API

Redis es opcional para el worker.

Uso:

- Preferir Supabase Queues/PGMQ si esta disponible porque ya vive en Postgres/Supabase.
- Cuando `REDIS_URL` existe, el worker puede usar BullMQ como alternativa.
- Queue name: `fbmaniaco-jobs`.
- Job names: `analyze_photo`, `generate_batch`, `generate_variant`, `schedule_posts`, `publish_post`, `retry_post`, `sync_remote_post`, `cancel_remote_post`, `reconcile_external_operation`, `collect_metrics`, `weekly_report`, `batch_caption_eval`.
- Job id/dedupe: usar `jobs.dedupe_key`.

Seguridad:

- `REDIS_URL` debe ser secreto.
- Acceso a PGMQ debe ser server-only.
- No exponer panel Redis publico.
- El celular solo pide comandos a la API; la API valida y crea jobs.

## Postgres/database URL

`DATABASE_URL` es obligatorio en el diseno profesional porque la DB es fuente primaria.

Reglas:

- `DATABASE_URL` es secreto.
- Debe haber migraciones.
- Debe separar por `workspaceId`, `businessId` y `actorId` desde el inicio.
- Tokens deben cifrarse en reposo.
- Page access tokens no deben quedar en tablas accesibles con anon key.

## Matriz de exposicion

| Dato | Puede verse en app movil | Puede verse en logs normales | Solo backend | Nunca persistir sin cifrado |
| --- | --- | --- | --- | --- |
| Nombre de pagina | Si | Si | No | No |
| Page ID | Si, aunque no es necesario destacarlo | Si | No | No |
| Page access token | No | No | Si | Cifrado obligatorio o gestor de secretos server-side equivalente |
| User access token | No | No | Si | Cifrado obligatorio o gestor de secretos server-side equivalente |
| Meta app secret | No | No | Si | Si |
| OpenAI API key | No | No | Si | Si |
| Supabase service role | No | No | Si | Si |
| Supabase anon key | Si, si se usa RLS | Si | No | No |
| Render API key | No | No | Automation segura | Si |
| Expo token | No | No | CI segura | Si |
| GitHub token | No | No | CI segura | Si |
| Imagen generada publica | Si | URL parcial, no dataURL | No | No |
| Imagen original privada | Solo si es del usuario | No | Si | Depende de politica |
| Prompt usado | No en UI final | No | Solo hash/version/ID | Prompt completo solo debug temporal privado con TTL |
| Caption final | Si | Si | No | No |
| SEO keywords | Si para el dueno | No publico | Si | No |
| Estado local JSON completo | No | No | Si | Si contiene tokens, cifrar o proteger |

## Logs seguros

Los logs deben ser estructurados. Campos permitidos:

- `timestamp`.
- `level`.
- `service`: mobile/api/worker/provider.
- `environment`.
- `release`.
- `requestId`.
- `traceId` si existe.
- `workspaceId`, `actorId`, `businessId`, `batchId`, `jobId` cuando aplique.
- Ruta normalizada, metodo y status code.
- Duracion en ms.
- Proveedor y operacion, si aplica.
- Codigo de error interno.
- Mensaje sanitizado.

Los logs no deben incluir:

- Headers `Authorization`.
- Headers `apikey`.
- Query strings con `access_token`.
- Body de `/auth/meta/callback` o `/auth/meta-token/support`.
- Body de `complete-upload` si trae `imageDataUrl`.
- Respuesta completa de Meta.
- Respuesta completa de OpenAI si contiene prompts o imagenes base64.
- `SUPABASE_SERVICE_ROLE`.

Reglas:

- Sanitizar CR/LF y delimitadores para evitar log injection.
- `debug` detallado solo en desarrollo o sesiones de soporte acotadas.
- En produccion, sampling para traces/performance; errores y eventos criticos siempre se capturan.
- Session Replay, si se habilita, debe enmascarar texto, imagenes y campos sensibles por defecto.
- Fallas del sistema de logs no deben romper la accion del usuario; deben degradar a salida local minima.

Alertas operativas minimas:

| Alerta | Umbral inicial |
| --- | --- |
| Error rate API | > 2% por 10 minutos. |
| Jobs fallidos | > 5% por tipo en 15 minutos. |
| Jobs atorados | `running` con `leaseExpiresAt` vencido. |
| Cola atrasada | jobs listos con espera > 10 minutos. |
| Meta permisos | aumento de `missing_scopes`, `revoked` o `requires_review`. |
| OpenAI costo/latencia | costo diario o p95 latencia fuera de presupuesto. |
| Publicaciones inciertas | cualquier `estado_incierto` en produccion. |
| Billing webhook failed | cualquier webhook `failed` no resuelto. |

## Retencion y privacidad

Reglas:

- Fotos originales: retener solo lo necesario para generar, reintentar y soporte; default recomendado 30 dias.
- Variantes generadas no aprobadas: default 60 dias o limpieza al cerrar/cancelar lote.
- Media aprobada/publicada: retener mientras el post exista o segun configuracion del negocio.
- Prompts completos y respuestas crudas de IA: no persistir salvo modo debug seguro y temporal.
- Exports diagnosticos: privados, con URL temporal, sin tokens y con expiracion.
- Eliminacion de workspace: crear `privacy_request`, pausar jobs, revocar/desconectar Meta si aplica, borrar media privada y anonimizar logs no necesarios.
- Datos necesarios para auditoria financiera/publicaciones pueden retenerse minimizados y sin secretos.

## Errores visibles al usuario

Los errores deben ser simples:

- "El acceso a Facebook expiro. Reconecta Facebook."
- "No se pudo generar la imagen. Intenta con menos fotos."
- "La foto es demasiado pesada."
- "No pudimos confirmar acceso valido a la pagina."
- "La publicacion quedo pausada hasta reconectar Facebook."

No deben mostrar:

- Stack traces.
- JSON crudo del proveedor.
- URLs con token.
- Codigos secretos.
- Variables de entorno.

## Reglas para reconstruir segura desde cero

1. Crear backend antes que app movil.
2. Todas las llamadas a Meta/OpenAI/Supabase service role deben salir del backend.
3. La app movil solo habla con la API de FBmaniaco.
4. El endpoint `/health` puede ser publico; el resto requiere sesion.
5. Los tokens de pagina deben guardarse server-side.
6. La app nunca debe guardar `pageAccessToken`.
7. En produccion, eliminar bootstrap token de la app.
8. Usar HTTPS publico en Android productivo.
9. Sanitizar logs.
10. Rate limit en generacion de imagen, captions, token y publish.
11. Idempotencia en publicacion para evitar duplicados.
12. Cifrar o proteger estado persistente si contiene tokens.
13. No permitir trabajar lotes cancelados.
14. No permitir publicar si token esta `expirado` o `requiere_reconexion`.
15. Cada llamada de publicacion debe registrar evento.

## Checklist de secretos antes de publicar APK

- `EXPO_PUBLIC_API_URL` apunta a Render HTTPS.
- `API_URL` apunta a Render HTTPS.
- `EXPO_PUBLIC_META_BOOTSTRAP_TOKEN` esta vacio.
- No existe `OPENAI_API_KEY` dentro del build movil.
- No existe `SUPABASE_SERVICE_ROLE` dentro del build movil.
- No existe `META_APP_SECRET` dentro del build movil.
- No existe `RENDER_API_KEY` dentro del build movil.
- No existe `.env` real en el repositorio.
- No existen backups/exportaciones con tokens en el repositorio.
- Render tiene variables marcadas como secret/sync false.
- Supabase RLS esta activa si la app usa anon key directo.

## Checklist de APIs antes de operar

- `/health` responde en Render.
- `/auth/bootstrap-status` no devuelve tokens.
- `/meta/pages` no devuelve `pageAccessToken`.
- `/meta/pages/select` solo acepta paginas conectadas.
- `/businesses/:businessId` no devuelve secretos.
- `complete-upload` no loguea `imageDataUrl`.
- `generate` respeta lote 1 o 2 para proveedor de imagen.
- `generate` asigna estilo por variante.
- `calendar/confirm` solo agenda variantes aprobadas.
- `publish` usa page token en backend.
- Worker marca `pausada_por_token` si falta token.
- `jobs` usa `dedupe_key` para generacion/publicacion.
- Worker puede recuperar jobs pendientes tras reinicio.
- Worker no reintenta side effects ambiguos sin consultar `external_operations`.
- `outbox_events` no guarda secretos, tokens, prompts completos ni base64.
- Supabase media bucket sirve imagenes publicas para Facebook.
- Buckets privados de backup no son publicos.

## Resumen operativo

Para controlar paginas de Facebook con seguridad:

- La app movil nunca controla Meta directamente.
- El usuario autoriza Meta.
- Backend guarda tokens.
- Backend lista paginas sin exponer page tokens.
- Usuario elige pagina.
- Backend crea jobs de generacion/publicacion.
- Worker genera contenido.
- Usuario aprueba.
- Backend/worker publica.
- Si el token falla, se pausa y se pide reconexion.

Para mantener independencia de la PC:

- Render corre la API.
- Supabase/Postgres guarda DB primaria.
- Supabase Storage guarda imagenes y backups opcionales.
- Worker procesa jobs.
- Expo/EAS genera APK con URL publica.
- GitHub guarda el codigo.
- La PC solo se usa para desarrollar, no para operar diario.

