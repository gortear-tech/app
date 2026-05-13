# FBmaniaco v1
### Plataforma movil para crear, aprobar y publicar posts de Facebook con IA

## 1. Vision general

FBmaniaco es una app movil para pequenos negocios que necesitan publicar en Facebook de forma constante sin depender de una computadora. El usuario conecta una pagina de Facebook, sube fotos reales del negocio, y el sistema crea variantes visuales cuadradas optimizadas para posts de Facebook, genera captions en espanol con SEO local, permite aprobar o rechazar cada resultado, y programa las publicaciones en un calendario real de Facebook.

El producto esta pensado para operar desde celular. La PC solo debe servir para desarrollo, no para correr la app en produccion. La API vive en Render, la fuente primaria de datos vive en Supabase/Postgres, las imagenes se guardan en Supabase Storage publico/controlado, y la app Android se instala mediante APK generado por Expo/EAS.

### Modelo de negocio y alcance real

El MVP no debe venderse como una agencia automatica ni como una suite multired. La promesa comercial correcta es:

- crear contenido visual y captions para Facebook a partir de fotos reales del negocio;
- ayudar al dueno a cubrir su semana o mes con publicaciones aprobadas;
- programar y publicar en una pagina de Facebook conectada;
- reducir trabajo repetitivo sin quitar control editorial al usuario.

Fronteras del MVP:

- Canal: Facebook Pages. Instagram, TikTok, anuncios pagados, grupos y multired quedan fuera.
- Usuario comprador: dueno/operador de pequeno negocio con una o pocas paginas.
- Unidad de valor: negocio/pagina conectada con calendario semanal cubierto.
- Flujo principal: humano aprueba contenido antes de programar o publicar.
- Autonomia: solo asistida en el MVP; publicacion automatica requiere opt-in explicito, historial suficiente, presupuesto configurado y permisos Meta aprobados.
- Operacion comercial externa: no debe prometer publicacion para clientes fuera de cuentas de prueba hasta completar App Review/Business Verification cuando Meta lo exija.

Modelo de cobro recomendado:

- Plan por workspace/negocio activo, con limites mensuales de fotos, variantes, publicaciones programadas y negocios conectados.
- Uso de IA medido por `pricing_rules`, reservado en `usage_meters` y auditado en `cost_ledger` para proteger margen.
- Creditos o sobreuso solo despues de confirmar precio visible al usuario.
- Ningun job costoso debe llamar proveedor si no hay plan valido, presupuesto disponible y reserva previa.
- La primera version puede operar sin cobro dentro de un piloto controlado, pero los contratos deben incluir plan, limites y ledger desde el inicio.

Tecnologia para monetizacion:

- No meter billing dentro del APK como dependencia central del MVP.
- Mantener `plan` y limites en DB como fuente de verdad.
- Si se cobra con tarjeta/suscripcion web, Stripe es la opcion preferida por madurez de subscriptions, usage-based billing, invoices y webhooks.
- Si el primer mercado exige pagos locales en Mexico/LatAm, Mercado Pago puede agregarse como provider de billing sin cambiar el modelo de datos.
- RevenueCat solo tiene sentido si el cobro vive dentro de tiendas moviles; para un B2B con APK y cobro web no debe ser la primera opcion.

## 2. Usuario principal

El usuario principal sigue siendo un operador/dueno que administra una o varias paginas de Facebook, pero el diseno profesional debe incluir usuario y workspace desde el inicio. Aunque el MVP opere con una sola cuenta, cada negocio debe pertenecer a un `workspaceId` y cada accion debe tener un `actorId` para auditoria.

El usuario necesita:

- Entrar con una sesion ligera de FBmaniaco.
- Conectar su cuenta de Meta o token controlado para autorizar paginas.
- Ver sus paginas de Facebook.
- Seleccionar una pagina como negocio activo.
- Subir fotos del negocio.
- Revisar que la IA entendio cada foto.
- Pedir variantes por foto.
- Aprobar/rechazar imagenes y captions.
- Programar publicaciones.
- Ver calendario y resolver fallas.
- Configurar SEO, tipos de contenido y estilos visuales.

Regla de autorizacion Meta:

- La experiencia principal de produccion no pide al usuario pegar tokens manuales.
- El usuario autoriza FBmaniaco mediante flujo oficial de Meta: OAuth, Facebook Login o device login segun convenga a movil.
- Meta siempre entrega credenciales tecnicas para listar paginas y publicar. Esas credenciales viven solo en backend/worker, cifradas o protegidas server-side.
- El token manual puede existir unicamente como modo desarrollo, soporte o migracion, detras de configuracion server-side y nunca como camino principal para clientes.

## 3. Principios de producto

1. Celular primero.
   La experiencia debe ser usable en pantalla chica. Cada flujo debe tener botones grandes, pasos claros, hojas inferiores y tarjetas compactas.

2. Facebook primero.
   La salida principal es una publicacion de Facebook con imagen cuadrada y caption corto. No se disena para Instagram, TikTok ni multired en el MVP.

3. El humano conserva control.
   Aunque el sistema aprende autonomia, el flujo comercial central usa aprobacion por swipe antes de programar. La autonomia no debe ser requisito para que el producto sea valioso.

4. La foto original no es el resultado.
   La foto original es materia prima. El sistema analiza la foto y genera variantes visuales. Desde la version actual, el estilo visual se asigna por variante, no por foto.

5. SEO natural, no keyword stuffing.
   Cada pagina puede tener palabras SEO para Facebook. Se integran de forma natural en el caption, con intencion local y pocos hashtags utiles.

6. Nada depende de memoria local de la PC.
   La fuente primaria de verdad debe ser Postgres/Supabase DB. El runtime en memoria, si existe, es cache operativo.

7. Cancelar significa cerrar.
   Un lote cancelado no debe seguir apareciendo como trabajable, no debe aceptar aprobar/rechazar, ni revivir si una generacion tardia termina despues de la cancelacion.

8. Valor antes que automatizacion.
   El primer objetivo es que el negocio tenga publicaciones buenas listas y programadas. La automatizacion profunda solo se agrega cuando aumente confianza, permisos, observabilidad y controles de costo.

## 4. Stack tecnico actual

Monorepo:

- `pnpm` workspaces.
- `turbo` como orquestador.
- TypeScript en apps y paquetes.

Lenguaje principal:

- TypeScript/TSX para app movil, API, worker, providers, servicios internos, scripts y pruebas de producto.
- SQL para schema, migraciones, queries, constraints, views y reportes cercanos a datos.
- PL/pgSQL solo para triggers/auditoria/summaries locales a la base de datos, nunca para llamadas Meta/OpenAI ni reglas complejas de UX.
- YAML para configuracion de deploy, EAS y pruebas E2E moviles con Maestro.
- Python/Go/Rust no forman parte del runtime principal del MVP; quedan como opciones futuras solo si aparece ML propio, procesamiento CPU-bound o necesidades de infraestructura mas exigentes.

Apps:

- `apps/api`: servidor Fastify.
- `apps/mobile`: Expo / React Native.
- `apps/worker`: worker para jobs asincronos de IA, programacion, publicacion, reintentos y metricas.

Paquetes:

- `packages/shared`: contratos, tipos y estados compartidos.
- `packages/providers`: adaptadores externos: OpenAI, Meta Graph, Supabase, mocks.
- servicios internos de inteligencia en API/worker: decision, memoria, estilos, prompts, captions, ranking y reportes.

Servicios externos:

- Supabase Auth para identidad de FBmaniaco, sesiones, JWT y base de permisos.
- OpenAI Responses API para analisis de vision y captions.
- OpenAI Images API para ediciones/generaciones de imagen.
- Meta Graph API para paginas, tokens, programacion y publicacion.
- Supabase Postgres para datos operativos.
- Supabase Storage para imagenes y respaldos.
- Supabase Queues/PGMQ para cola fisica preferida de jobs.
- Supabase Cron para tareas recurrentes de mantenimiento, reportes y reencolado.
- Render para hospedar API publica.
- Render Background Worker para procesos largos y reintentos.
- Expo/EAS para construir APK Android.
- Sentry para errores de app movil, API y worker.

Librerias internas recomendadas:

- TanStack Query en la app movil para cache de servidor, invalidacion y refetch.
- Expo SecureStore para guardar solo sesion local y valores sensibles pequenos.
- JSON Schema + TypeBox en API para contratos compartidos con Fastify.
- OpenAPI generado desde rutas Fastify para documentar endpoints reales.
- Sharp/libvips en worker si hace falta resize, compresion, conversion o thumbnails antes/despues de Storage.
- Vitest para pruebas unitarias de servicios internos, contratos y jobs.
- Maestro para pruebas E2E moviles sobre APK/EAS.
- Playwright para smoke tests HTTP o panel web/admin si aparece.

## 5. Arquitectura general

Flujo principal:

```text
App Android
  -> TanStack Query: cache remoto e invalidaciones
  -> API Fastify publica
    -> Supabase Auth: usuario/sesion
    -> Supabase Postgres: fuente primaria de verdad
    -> Jobs/cola: IA, programacion y publicacion
    -> Supabase Queues/PGMQ: cola fisica preferida
    -> Worker asincrono en Render
    -> Supabase Storage: imagenes subidas/generadas
    -> OpenAI vision/caption/image
    -> Meta Graph API
    -> Servicios internos de inteligencia
    -> Sentry/tracing/logs/metricas
```

La base de datos relacional es la fuente primaria de verdad. La API puede mantener cache en memoria para lecturas frecuentes, pero cada mutacion critica se confirma en DB antes de responder exito. Supabase Storage guarda media y puede guardar respaldos compactos, pero no reemplaza la DB.

### Contrato de comunicacion entre modulos

Regla maestra:

- La app movil solo se comunica con la API publica.
- La API es el coordinador unico de comandos, lecturas, permisos y creacion de jobs.
- Supabase Auth identifica al usuario de FBmaniaco; Meta solo autoriza paginas y publicaciones.
- La DB es la fuente de verdad para usuarios, workspaces, paginas, negocios, lotes, fotos, variantes, publicaciones, jobs y eventos.
- La inteligencia vive como servicios internos de API/worker.
- Providers ejecutan Meta, OpenAI y Supabase Storage, pero no deciden reglas de negocio.
- El worker ejecuta IA, programacion, publicaciones, reintentos y metricas mediante jobs idempotentes.
- La app usa TanStack Query para refrescar datos por `queryKey` tras cada comando, en vez de sincronizar pantallas a mano.
- Supabase Cron solo despierta mantenimientos o encola pendientes; no reemplaza jobs ni worker.

Toda mutacion sigue el mismo orden:

1. Validar negocio, pagina, permisos y estado.
2. Bloquear estados cerrados o acciones duplicadas.
3. Crear comando o job si la accion es lenta/costosa.
4. Ejecutar decision IA interna si aplica.
5. Mutar DB dentro de una transaccion cuando corresponda.
6. Registrar evento de dominio si aporta auditoria o aprendizaje.
7. Responder a la app con entidad sanitizada, `jobId`, `nextStep` y alertas cuando aplique.

El documento `14_comunicacion.md` es la referencia transversal. Si un modulo necesita intercambiar datos con otro, debe hacerlo mediante API, comandos, lecturas, jobs, estados compartidos, eventos de dominio o summaries/detail responses definidos alli.

## 6. Modelo mental del producto

### Pagina

Una pagina de Facebook representa el negocio real. Contiene:

- `pageId`
- `pageName`
- `coverPhotoUrl`
- `pageAccessToken`
- `pageAccessTokenStatus`
- categoria y tareas de Meta cuando estan disponibles.

### Usuario

Un usuario representa a una persona que puede operar FBmaniaco.

Campos:

- `id`
- `workspaceId`
- `email`
- `displayName`
- `role`
- `status`

En MVP puede existir un solo usuario owner, pero todos los registros deben poder relacionarse con `actorId`.

### Workspace

Un workspace agrupa negocios y usuarios.

Campos:

- `id`
- `name`
- `ownerUserId`
- `plan`
- `status`

Esto prepara multiusuario sin obligar a construir permisos complejos desde el primer dia.

### Negocio

El negocio es una envoltura propia de FBmaniaco alrededor de la pagina:

- `id`
- `workspaceId`
- `facebookPageId`
- `name`
- `industry`
- `timezone`
- `tokenStatus`
- `metadata`
- `autonomySettings`

`metadata` guarda configuraciones flexibles como:

- `facebookSeoKeywords`
- `facebookSeoContext`
- `contentTypes`
- `tone`
- `pageName`

### Lote

Un lote agrupa fotos, variantes y publicaciones programadas.

Estados:

- `pending_upload`
- `pendiente_confirmacion`
- `confirmado`
- `generando`
- `generado_parcial`
- `completado`
- `fallido`
- `cancelado`
- `abandonado`

Regla critica:

- `cancelado`, `fallido` y `abandonado` no se pueden trabajar.
- `completado` no permite volver a aprobacion si ya llego a Meta.
- Los lotes cancelados/abandonados no deben aparecer en la lista operativa.

### Foto

Una foto representa el archivo original subido por el usuario.

Campos funcionales actuales:

- `id`
- `batchId`
- `fileName`
- `storageKey`
- `uploadUrl`
- `status`
- `visionAnalysis`
- `createdAt`
- `updatedAt`

Importante:

- La foto ya no guarda `assignedStyle`.
- La foto ya no guarda `editingPrompt`.
- El analisis de vision si pertenece a la foto.
- El estilo pertenece a cada variante.

### Variante

Una variante es el resultado generable/publicable.

Campos:

- `id`
- `batchId`
- `photoId`
- `styleId`
- `assignedStyle`
- `generationPlan`
- `modelProfileId`
- `promptVersion`
- `aiRunId`
- `qualityCheckId`
- `imageUrl`
- `caption`
- `status`
- `createdAt`
- `updatedAt`

Estados:

- `pendiente`
- `generando`
- `generada`
- `fallida`
- `aprobada`
- `rechazada`
- `programada`
- `publicada`
- `eliminada`

La variante guarda el estilo completo elegido para ese resultado. Esto permite que una misma foto produzca varias publicaciones con estilos visuales distintos.

### Publicacion programada

Representa una publicacion creada por FBmaniaco para calendario. Puede estar solo programada localmente o ya confirmada en Meta; `remoteStatus` define esa diferencia y obliga las reglas de edicion/cancelacion.

Regla de entrega:

- El modo base es `local_due_publish`: FBmaniaco agenda en DB y el worker publica en Meta cuando llegue la hora.
- `remote_schedule` solo se usa si la pagina tiene capacidades probadas para crear, leer y cancelar posts programados en Meta.
- Una variante es una publicacion de una sola foto; el provider Meta debe publicar por el edge de fotos de Page cuando aplique.

Campos:

- `id`
- `variantId`
- `businessId`
- `batchId`
- `scheduledFor`
- `facebookPostId`
- `deliveryMode`
- `remotePostType`
- `remotePostUrl`
- `status`
- `remoteStatus`
- `lastRemoteSyncAt`
- `retryCount`
- timestamps.

Estados:

- `pendiente`
- `programada`
- `publicacion_en_proceso`
- `publicada`
- `estado_incierto`
- `fallida`
- `pausada_por_token`
- `cancelada`

### Job

Un job representa trabajo asincrono y reintentable.

Campos:

- `id`
- `type`
- `status`
- `businessId`
- `batchId`
- `photoId`
- `variantId`
- `scheduledPostId`
- `dedupeKey`
- `attempts`
- `runAfter`
- `lastError`
- `createdAt`
- `updatedAt`

Tipos minimos:

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

Jobs principales:

- `analyze_photo`
- `generate_batch`
- `generate_variant`
- `schedule_posts`
- `publish_post`
- `retry_post`
- `reconcile_external_operation`
- `collect_metrics`
- `weekly_report`
- `batch_caption_eval`

## 7. Ciclo completo de usuario

1. Usuario abre app.
2. App consulta `/auth/bootstrap-status`.
3. Si falta conexion, inicia autorizacion oficial de Meta o recupera device login pendiente. El token manual solo aparece en modo desarrollo/soporte.
4. API valida token con Meta, obtiene paginas y page tokens.
5. Usuario selecciona pagina.
6. API crea o reutiliza negocio para esa pagina.
7. Home muestra lote activo, alertas y calendario.
8. Usuario crea o abre lote.
9. Usuario selecciona fotos.
10. App pide upload intent y completa subida.
11. API confirma objeto privado en Storage y registra `MediaAsset` original.
12. API crea job `analyze_photo`.
13. Worker analiza foto con OpenAI Vision y la marca `validada`.
14. Lote pasa a `pendiente_confirmacion`.
15. Usuario revisa fotos analizadas.
16. Usuario decide cuantas variantes por foto.
17. API estima costo con tabla de precios de proveedor/modelo y confirma presupuesto antes de generar.
18. API crea job `generate_batch` y jobs `generate_variant`:
    - elige direccion creativa;
    - asigna estilo por variante;
    - construye generation plan;
    - pide imagen cuadrada;
    - sube imagen generada a Storage privado;
    - crea asset publicable solo al aprobar/programar;
    - genera caption con SEO;
    - guarda evento de aprendizaje.
19. Usuario aprueba o rechaza por swipe.
20. Usuario elige periodo de programacion: 7, 14 o 30 dias.
21. API crea job `schedule_posts`.
22. Worker ordena variantes por prediccion simple y distribuye dias.
23. Worker crea scheduled posts y jobs `publish_post` cuando aplique.
24. Calendario muestra publicaciones.
25. Usuario puede editar fecha/hora, cancelar o reintentar fallidas.

## 8. Pantallas principales

Pantallas app:

- `boot`: pantalla de arranque.
- `meta_connect`: conectar o reconectar Meta.
- `pages`: elegir pagina.
- `welcome`: bienvenida de negocio conectado.
- `home`: dashboard principal.
- `batch`: flujo de lote.
- `calendar`: calendario.
- `settings`: configuracion.
- `styles`: editor de estilos.
- `report`: reporte semanal.
- `reconnect`: reconexion Meta.

## 9. Regla actual de estilos visuales

Antes el sistema asignaba estilo a cada foto. Eso se reemplazo.

Regla vigente:

- La foto solo se analiza.
- Cada variante decide su propio estilo.
- La asignacion usa:
  - industria del negocio;
  - keywords SEO;
  - tipo y descripcion del sujeto;
  - mood y composicion;
  - elementos sensibles;
  - memoria historica;
  - penalizacion fuerte por estilos repetidos en la misma foto;
  - penalizacion moderada por estilos repetidos en el lote.

Efecto esperado:

- Si una foto pide 3 variantes, cada variante debe sentirse visualmente distinta.
- Si ya se uso mucho un estilo en el lote, baja su prioridad.
- Si hay logos, texto, precio o personas, estilos fuertes reciben castigo.

## 10. Regla actual de captions

Cada caption se genera con:

- prompt base de la variante;
- nombre de estilo;
- descripcion del sujeto;
- tono del negocio;
- keywords SEO de Facebook;
- contexto SEO adicional;
- direccion creativa de copy;
- direccion visual de la imagen;
- indice de variante;
- captions recientes a evitar.

El caption debe:

- estar en espanol;
- ser natural para Facebook;
- tener una o dos frases maximo;
- evitar inicios repetidos;
- evitar estructuras parecidas a captions recientes;
- usar maximo dos hashtags si aportan descubrimiento;
- integrar SEO sin sonar forzado.

## 11. Regla de imagen

La imagen generada debe ser cuadrada y util para Facebook.

Instrucciones obligatorias del prompt:

- relacion 1:1;
- composicion centrada;
- margen visual amplio;
- no recortar producto/persona/logo/texto importante;
- no agregar texto nuevo;
- mantener producto real;
- fondo y estilo pueden cambiar segun variante;
- cada variante debe ser distinta de sus hermanas.

## 12. Seguridad de estado

Toda accion relevante debe persistir estado. En especial:

- conectar token;
- seleccionar pagina;
- crear negocio;
- crear lote;
- subir foto;
- cancelar lote;
- estimar/confirmar costo;
- crear variante;
- generar imagen;
- generar caption;
- aprobar/rechazar;
- editar caption;
- programar;
- editar publicacion;
- cancelar publicacion;
- reintentar;
- publicar;
- guardar estilos;
- actualizar SEO.

Regla de cierre:

- una accion sobre lote cerrado debe regresar error 409 con mensaje entendible.

## 13. Autonomia

La autonomia se maneja por accion:

- `STYLE_ASSIGNMENT`
- `VARIANT_COUNT`
- `SCHEDULING`
- `CAPTION_GENERATION`
- `FACEBOOK_PUBLISH`

Cada accion tiene:

- score;
- approvals;
- threshold;
- paused;
- consecutive approvals;
- consecutive rejections.

El sistema puede subir o bajar autonomia segun aprobaciones/rechazos. En el MVP, la UI permite ver si una accion es autonoma o requiere confirmacion, y resetear valores autonomos.

Regla comercial:

- El MVP puede aprender preferencias y sugerir horarios, estilos y captions.
- El MVP no debe activar `FACEBOOK_PUBLISH` autonomo por defecto.
- La publicacion automatica se considera una capacidad premium/riesgosa, no la promesa base.
- Si falta App Review, Business Verification, presupuesto, observabilidad o controles de pausa, la publicacion automatica queda deshabilitada aunque tecnicamente sea posible.

## 14. Documentacion modular

Este documento maestro no reemplaza los modulos. Cada modulo detalla pantallas, endpoints, datos, copy y comportamiento de una parte concreta.

Orden de referencia:

- Usar `00_indice.md` como mapa y autoridad documental.
- Usar `14_comunicacion.md` para contratos entre modulos.
- Usar `11_datos.md` para nombres de entidades, estados, jobs y tablas.
- Usar `10_seguridad.md` para secretos, tokens y exposicion.

