# Modulo 10 - Contratos, datos, estados y tablas

Fecha de corte: 2026-05-08
Objetivo: dejar contratos duros para reconstruir FBmaniaco sin depender de interpretaciones del codigo actual.

Este documento complementa los modulos 7 y 9. El modulo 7 explica la arquitectura de API, comandos, lecturas y jobs; este modulo fija los tipos, estados, tablas y transiciones que una reconstruccion debe respetar.

## Principio

FBmaniaco vive de estados. Una publicacion no es solo una imagen: pasa por pagina, negocio, lote, foto, analisis, variante, aprobacion, calendario, publicacion y aprendizaje.

Si los estados se vuelven ambiguos, aparecen los problemas que ya se vieron:

- Lotes cancelados que siguen trabajandose.
- Publicaciones pausadas sin explicacion clara.
- Variantes repetidas.
- Fotos recortadas mal en revision.
- App que depende de una PC local.

Regla:

Cada entidad debe tener un estado claro, transiciones permitidas, acciones bloqueadas y respuesta visible al usuario.

## Comunicacion por contratos

Los datos no deben viajar como objetos improvisados entre pantallas. Cada modulo debe usar una de estas formas:

- `summary`: lista compacta para Home, Calendario y reportes.
- `detail`: entidad sanitizada para pantalla de trabajo.
- `mutation`: respuesta de accion con entidad cambiada, `changed`, `nextStep` y alertas opcionales.
- `event`: registro de dominio para aprendizaje, auditoria y diagnostico.
- `error`: `AppErrorResponse` seguro para UI.

Reglas:

- La fuente de verdad es Postgres/Supabase DB, no el cache del celular, runtime en memoria ni snapshot.
- Toda entidad visible debe incluir `id`, `status` y `updatedAt` cuando existan.
- Toda relacion critica debe viajar por ID: `businessId`, `batchId`, `photoId`, `variantId`, `scheduledPostId`.
- La app no debe recibir tokens, prompts completos, headers de proveedores ni payloads crudos.
- Un cambio de estado debe ser atomico: si el servidor responde exito, la entidad ya quedo persistida.
- Toda mutacion costosa o externa debe ser idempotente mediante `Idempotency-Key`.
- Toda respuesta de mutacion debe incluir `requestId` para trazabilidad.

## Reglas canonicas de contratos

Estas reglas evitan que API, DB, worker y app movil nombren lo mismo de formas distintas.

- API y paquetes compartidos usan `camelCase`: `businessId`, `scheduledFor`, `remoteStatus`.
- DB usa `snake_case`: `business_id`, `scheduled_at`, `remote_status`.
- No crear contratos nuevos con aliases historicos en espanol como `negocioId`; solo pueden aparecer en migraciones/adaptadores legacy.
- IDs internos son strings opacos para la app. En DB pueden ser `uuid` o `text`, pero deben generarse server-side, ser inmutables y no depender de IDs externos.
- IDs externos conservan nombre explicito: `metaPageId`, `facebookPostId`, `providerCustomerId`.
- Todo contrato evolutivo incluye `schemaVersion`; toda salida IA incluye tambien `promptVersion` o `planVersion` cuando aplique.
- Toda entidad multi-tenant debe tener `workspaceId`/`workspace_id` directo, incluso si tambien puede inferirse por joins. Esto simplifica RLS, auditoria e indices.
- Las lecturas para UI salen de DTOs/views sanitizadas, no de tablas crudas.
- Los JSON flexibles (`metadata`, `entitlements`, `payload`, `result`) deben tener schema documentado y versionado si afectan negocio.

Regla de seguridad de base de datos:

- En Supabase, toda tabla del schema expuesto debe tener RLS habilitado.
- La app movil no debe consultar tablas con secretos. Si se expone Supabase directo para Auth o lecturas futuras, usar views/RPC sanitizadas.
- `service_role` puede operar desde API/worker, pero las validaciones de workspace, actor, estado e idempotencia siguen siendo obligatorias en codigo de dominio.

Regla de integridad:

- Usar foreign keys para relaciones internas cuando no rompan migraciones iniciales.
- Usar `ON DELETE RESTRICT` para entidades con historia comercial o de publicacion.
- Usar `ON DELETE CASCADE` solo en tablas puramente dependientes y no auditables.
- Usar `CHECK` para enums criticos de estado cuando el equipo ya haya estabilizado los valores; durante migraciones tempranas, documentar los valores en `packages/shared`.

## Entidades principales

### User

Actualmente la app esta pensada para un dueno unico. En una reconstruccion profesional debe existir usuario real aunque inicialmente solo haya una cuenta.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | Identificador interno. |
| `workspaceId` | string | Workspace principal o activo. |
| `email` | string | Correo del dueno. |
| `displayName` | string nullable | Nombre visible. |
| `role` | `owner`, `admin`, `operator`, `viewer` | Rol dentro del workspace. |
| `status` | `activo`, `bloqueado`, `eliminado` | Estado de acceso. |
| `createdAt` | ISO string | Alta. |
| `lastLoginAt` | ISO string nullable | Ultimo inicio de sesion. |

Reglas:

- El usuario no debe contener tokens de Meta directamente.
- Si se implementa login por correo/contrasena, contrasenas hasheadas y pepper server-only.
- Si se implementa login social, token del proveedor separado del token de paginas Meta.
- El rol efectivo para un workspace se toma de `workspace_members`, no de un campo global del usuario cuando haya multiworkspace.

### Workspace

Agrupa usuarios, negocios, paginas y permisos.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | Identificador. |
| `name` | string | Nombre del espacio. |
| `ownerUserId` | string | Dueno principal. |
| `plan` | string nullable | Plan comercial vigente: `piloto`, `starter`, `pro`, `agency` o equivalente. |
| `billingStatus` | `trial`, `active`, `past_due`, `paused`, `cancelled` | Estado comercial. |
| `entitlements` | object nullable | Limites comerciales aplicables al workspace. |
| `status` | `activo`, `pausado`, `eliminado` | Estado. |
| `createdAt` | ISO string | Alta. |
| `updatedAt` | ISO string | Cambio. |

Reglas:

- Todo negocio debe pertenecer a un workspace.
- Toda accion debe registrar `actorId` cuando exista usuario real.
- MVP puede crear un workspace default para el dueno unico.
- Las reglas de plan/limites se aplican server-side; la app solo muestra permisos y mensajes sanitizados.
- Si `billingStatus` no permite operar, los comandos costosos quedan bloqueados con `userMessage` claro.

Entitlements recomendados:

```ts
type WorkspaceEntitlements = {
  maxBusinesses: number;
  monthlyPhotoUploads: number;
  monthlyGeneratedVariants: number;
  monthlyScheduledPosts: number;
  monthlyAiBudgetUsd: number;
  includedAiCreditsUsd: number;
  overagePolicy: "block" | "confirm_each_time" | "allow_until_budget";
  costAlertThresholdsPct: number[];
  canUseAutopublish: boolean;
  canUseAdvancedStyles: boolean;
  canUseReports: boolean;
};
```

Reglas:

- Los limites se consumen y reservan en backend, nunca en cliente.
- Antes de crear jobs costosos, la API debe reservar cupo en `usage_meters` dentro de la misma transaccion que confirma el costo.
- Si no hay cupo o presupuesto, la API bloquea antes de llamar OpenAI/Meta/Storage.
- Los creditos incluidos no son dinero guardado por el proveedor de pagos; son politica interna del producto.

### WorkspaceMember

Relaciona usuarios con workspaces y define permisos internos.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `workspaceId` | string | Workspace. |
| `userId` | string | Usuario. |
| `role` | `owner`, `admin`, `operator`, `viewer` | Rol. |
| `status` | `active`, `invited`, `disabled` | Estado. |
| `createdAt` | ISO string | Alta. |

Matriz minima:

| Accion | owner | admin | operator | viewer |
| --- | --- | --- | --- | --- |
| Ver dashboard/calendario | Si | Si | Si | Si |
| Subir fotos/generar variantes | Si | Si | Si | No |
| Aprobar/rechazar contenido | Si | Si | Si | No |
| Publicar/cancelar posts | Si | Si | Si | No |
| Conectar/cambiar Meta | Si | Si | No | No |
| Cambiar billing/plan | Si | No | No | No |
| Invitar/quitar miembros | Si | Si | No | No |
| Exportar/eliminar workspace | Si | No | No | No |

Reglas:

- La API valida rol en cada comando; la UI solo oculta acciones como conveniencia.
- `owner` no puede ser removido si es el unico owner activo.
- Todo cambio de miembros debe escribir `audit_logs`.

### BillingAccount

Representa la relacion con el proveedor de cobro. No debe ser requisito para pilotos internos, pero el modelo existe desde el inicio para evitar redisenar cuando se cobre.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | Identificador interno. |
| `workspaceId` | string | Workspace propietario. |
| `provider` | `stripe`, `mercado_pago`, `manual` | Proveedor de cobro. |
| `providerCustomerId` | string nullable | ID externo del cliente. |
| `providerSubscriptionId` | string nullable | ID externo de suscripcion. |
| `providerSubscriptionItemId` | string nullable | Item de suscripcion usado para usage-based billing, si aplica. |
| `providerPriceId` | string nullable | Precio/plan externo vigente. |
| `status` | `trial`, `active`, `past_due`, `paused`, `cancelled` | Estado comercial normalizado. |
| `currentPeriodStart` | ISO string nullable | Inicio de periodo. |
| `currentPeriodEnd` | ISO string nullable | Fin de periodo. |
| `createdAt` | ISO string | Alta. |
| `updatedAt` | ISO string | Cambio. |

Reglas:

- Webhooks de billing actualizan DB, nunca desbloquean funciones solo en cliente.
- El proveedor de cobro no decide costos de IA; `pricing_rules`, `usage_meters` y `cost_ledger` siguen siendo la fuente de margen y consumo.
- `manual` permite pilotos, ventas directas o pruebas sin integrar pagos todavia.
- Los eventos de Stripe/Mercado Pago se procesan con idempotencia en `billing_provider_events`.
- Stripe Entitlements puede alimentar features, pero la fuente final para autorizar comandos es `workspace.entitlements` normalizado.

### Session

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `accessToken` | string | Token corto de sesion propia de FBmaniaco. |
| `refreshToken` | string | Renovacion. |
| `expiresAt` | ISO string | Caducidad. |
| `sessionId` | string | ID revocable. |

Reglas:

- Estos tokens son de FBmaniaco, no de Meta.
- Deben guardarse en almacenamiento seguro del celular.
- En logs no se imprimen.

### MetaAuthorization

Representa la autorizacion Meta otorgada por un usuario para operar paginas. Es distinta de `MetaPage`: una autorizacion puede conceder varias paginas y puede perder scopes aunque las paginas sigan existiendo en DB.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID interno. |
| `workspaceId` | string | Workspace propietario. |
| `actorId` | string nullable | Usuario FBmaniaco que autorizo. |
| `metaUserId` | string nullable | ID del usuario Meta, si se obtiene. |
| `status` | `pending`, `valid`, `missing_scopes`, `requires_review`, `expired`, `revoked`, `error` | Estado operativo. |
| `grantedScopes` | string[] | Scopes concedidos. |
| `declinedScopes` | string[] | Scopes rechazados/faltantes. |
| `missingRequiredScopes` | string[] | Scopes requeridos para MVP que faltan. |
| `grantedPageIds` | string[] | IDs externos de paginas concedidas por permisos granulares. |
| `appMode` | `development`, `live`, `unknown` | Modo de la app Meta al autorizar. |
| `appReviewStatus` | `development`, `review_required`, `approved`, `rejected`, `unknown` | Estado normalizado para operar con externos. |
| `graphApiVersion` | string | Version Graph usada. |
| `tokenExpiresAt` | ISO string nullable | Caducidad tecnica si aplica. |
| `lastDebugAt` | ISO string nullable | Ultima validacion con `/debug_token`. |
| `encryptedAccessToken` | string nullable | Token cifrado o referencia server-only. |
| `tokenKeyId` | string nullable | Version de llave usada para cifrado. |
| `lastUsedAt` | ISO string nullable | Ultimo uso tecnico. |
| `createdAt` | ISO string | Alta. |
| `updatedAt` | ISO string | Cambio. |

Reglas:

- No guardar user access token en claro; cifrar o guardar en mecanismo server-only equivalente.
- `pages_show_list`, `pages_read_engagement` y `pages_manage_posts` son requeridos para operar el MVP completo.
- `business_management` y `pages_manage_metadata` son opcionales y deben pedirse solo si hay flujo implementado que los justifique.
- Si faltan scopes requeridos, ninguna pagina debe quedar como lista para publicar.
- Si `appReviewStatus` no permite clientes externos, solo workspaces de prueba/dev pueden publicar.
- Si una pagina deja de estar en `grantedPageIds`, su `pageAccessTokenStatus` pasa a `requiere_reconexion` o `error_permiso`.

### MetaPage

Representa una pagina de Facebook que el usuario administra.

Campos internos:

| Campo | Tipo | Visible en app | Descripcion |
| --- | --- | --- | --- |
| `id` | string | Si | ID interno de la pagina conectada. |
| `workspaceId` | string | No | Workspace propietario. |
| `metaAuthorizationId` | string nullable | No | Autorizacion que entrego/actualizo esta pagina. |
| `metaPageId` / `pageId` | string | Si | ID externo de pagina Meta. En contratos nuevos preferir `metaPageId`; `pageId` puede quedar como alias de respuesta por compatibilidad. |
| `pageName` | string | Si | Nombre visible. |
| `coverPhotoUrl` | string nullable | Si | Imagen/thumbnail. |
| `category` | string nullable | Si | Categoria principal. |
| `categoryList` | array nullable | Si | Categorias Meta. |
| `tasks` | string[] nullable | Si | Permisos/tareas devueltas por Meta. |
| `isGranted` | boolean | Si | La pagina fue concedida en permisos granulares. |
| `isSelected` | boolean | Si | Pagina activa. |
| `pageAccessTokenStatus` | FacebookTokenStatus | Si | Estado sanitizado. |
| `pageAccessToken` | string nullable | No | Token para publicar. Solo backend. |
| `pageAccessTokenKeyId` | string nullable | No | Version de llave de cifrado/referencia. |
| `lastTokenUseAt` | ISO string nullable | No | Ultimo uso tecnico. |
| `grantedScopes` | string[] nullable | Si | Permisos concedidos sanitizados. |
| `declinedScopes` | string[] nullable | Si | Permisos faltantes/rechazados. |
| `tokenExpiresAt` | ISO string nullable | No | Caducidad tecnica si aplica. |
| `lastDebugAt` | ISO string nullable | No | Ultima validacion con Meta. |
| `graphApiVersion` | string nullable | Si | Version Graph usada. |

Reglas:

- `metaPageId` no es primary key global. La unicidad correcta es `workspaceId + metaPageId`.
- La pagina solo puede seleccionarse si `isGranted = true` y tiene scopes/tareas suficientes.
- `pageAccessToken` jamas viaja al celular.
- `pageAccessToken` y user tokens de Meta deben cifrarse o guardarse mediante mecanismo server-only equivalente.
- `pageAccessTokenStatus` debe sincronizarse con negocio.
- Si la pagina pierde permiso, el negocio queda `requiere_reconexion` o `error_permiso`.

### Business

Negocio interno vinculado a una pagina.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID interno. |
| `workspaceId` | string | Workspace propietario. |
| `name` | string | Nombre editable. |
| `industry` | string | Industria, por ejemplo sushi/restaurante. |
| `facebookPageId` | string | Relacion con la pagina conectada interna; si se usa ID externo, debe validarse por `workspaceId`. |
| `timezone` | string | Zona horaria para calendario. |
| `tokenStatus` | FacebookTokenStatus | Estado de conexion Meta. |
| `metadata` | object | Configuracion flexible: SEO, tono, preferencias. |
| `autonomySettings` | object | Umbrales de autonomia. |
| `createdAt` | ISO string | Alta. |
| `updatedAt` | ISO string | Ultima modificacion. |

Metadata recomendada:

```ts
type BusinessMetadata = {
  tone?: string;
  contentTypes?: string[];
  facebookSeo?: {
    keywords: string[];
    context?: string | null;
  };
  defaultSchedule?: {
    preferredHours?: string[];
    avoidDays?: string[];
  };
  privacy?: {
    originalMediaRetentionDays?: number;
    generatedMediaRetentionDays?: number;
    publishableMediaRetentionDays?: number;
    allowTrainingUse?: false;
  };
};
```

Reglas:

- `metadata.facebookSeo.keywords` alimenta captions, no se imprime como lista publica.
- `timezone` define dias reales del calendario.
- `facebookPageId` no puede cambiarse a una pagina que no pertenezca al usuario.
- Un workspace puede tener como maximo un negocio activo por pagina conectada, salvo que se disene multi-marca explicitamente.
- Fotos originales son privadas por defecto; solo variantes aprobadas/publicables pueden moverse a bucket o URL legible por Meta.
- No usar fotos, captions o metricas de un workspace para entrenar/mejorar otro workspace.

### Batch

Lote de creacion de publicaciones.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID del lote. |
| `businessId` | string | Negocio propietario. |
| `status` | BatchStatus | Estado del flujo. |
| `photosCount` | number | Fotos asociadas. |
| `variantsCount` | number | Variantes creadas. |
| `estimatedCostUsd` | number nullable | Estimacion visible antes de generar. |
| `estimatedProviderCostUsd` | number nullable | Estimacion interna de proveedor. |
| `confirmedCostUsd` | number nullable | Costo aprobado por usuario. |
| `confirmedPriceVersion` | string nullable | Version de pricing aprobada. |
| `confirmedCostBreakdown` | object nullable | Desglose sanitizado del costo. |
| `lastActivityAt` | ISO string | Ultimo movimiento. |
| `variantsPerPhoto` | number | Cantidad elegida. |
| `photoIds` | string[] | IDs de fotos. |
| `variantIds` | string[] | IDs de variantes. |
| `scheduledPostIds` | string[] | IDs de posts programados. |
| `createdAt` | ISO string | Creacion. |
| `updatedAt` | ISO string | Actualizacion. |

Reglas:

- Las relaciones verdaderas viven en `photos`, `variants` y `scheduled_posts` por sus IDs/FK logicas.
- `photoIds`, `variantIds` y `scheduledPostIds` solo pueden ser cache o summary reconstruible, no fuente primaria.

Estados:

| Estado | Significado | Acciones permitidas |
| --- | --- | --- |
| `pending_upload` | Lote creado, espera fotos. | Subir fotos, cancelar. |
| `pendiente_confirmacion` | Fotos analizadas, falta confirmar cantidad/costo. | Estimar, confirmar, cancelar. |
| `confirmado` | Usuario acepto costo. | Generar, cancelar. |
| `generando` | IA trabajando. | Ver progreso, cancelar. |
| `generado_parcial` | Hay variantes listas para aprobar. | Aprobar, rechazar, editar caption, calendario, cancelar si no llego a Meta. |
| `completado` | Ya termino flujo. | Consultar historial. |
| `fallido` | No pudo generar o publicar. | Diagnosticar, tal vez reintentar segun causa. |
| `cancelado` | Usuario lo cerro. | Consultar solo lectura. |
| `abandonado` | Sistema lo marco viejo/inactivo. | Reabrir solo si reglas lo permiten. |

Estados cerrados:

```txt
completado, fallido, cancelado, abandonado
```

Toda ruta de trabajo debe bloquear esos estados.

### Photo

Foto original subida por usuario.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID de foto. |
| `workspaceId` | string | Workspace. |
| `businessId` | string | Negocio. |
| `batchId` | string | Lote propietario. |
| `fileName` | string nullable | Nombre original. |
| `storageKey` | string nullable | Key de Storage. |
| `originalAssetId` | string nullable | MediaAsset original privado. |
| `thumbnailAssetId` | string nullable | MediaAsset thumbnail. |
| `visionInputAssetId` | string nullable | Derivado usado para vision. |
| `mediaUrl` | string nullable | URL renderizable/controlada para lectura. |
| `thumbnailUrl` | string nullable | Preview ligera si se genera. |
| `contentHash` | string nullable | Hash para deduplicar o diagnosticar. |
| `mimeType` | string nullable | Tipo de archivo confirmado. |
| `width` | number nullable | Ancho detectado. |
| `height` | number nullable | Alto detectado. |
| `status` | PhotoStatus | Estado. |
| `visionAnalysis` | VisionAnalysisResult nullable | Analisis estructurado. |
| `createdAt` | ISO string | Alta. |
| `updatedAt` | ISO string | Ultima actualizacion. |

Estados:

| Estado | Significado |
| --- | --- |
| `subida` | Foto recibida. |
| `analizando` | Vision IA corriendo. |
| `validada` | Analisis listo y foto usable. |
| `optimizada` | Se genero una version mejorada si se implementa. |
| `clasificada` | Se categorizo por tipo/uso. |
| `descartada` | Usuario o sistema no la usara. |
| `usada` | Ya genero variantes. |
| `eliminada` | No debe usarse mas. |

Reglas:

- Una foto sin `visionAnalysis` no debe generar variantes.
- Si falla vision, la foto debe salir del lote o quedar con estado visible de error.
- No guardar `imageDataUrl` largo como fuente principal si ya existe URL de Storage.
- `uploadUrl` firmado es transitorio y no debe persistirse como campo de foto; la entidad guarda `storageKey`, `mediaUrl` y metadata confirmada.
- La API/worker debe registrar `MediaAsset` para original, thumbnail y entrada de vision.
- OpenAI Vision debe recibir URL firmada temporal o archivo server-side; nunca una URL publica permanente de originales.
- El worker debe corregir orientacion EXIF y remover metadata sensible antes de crear derivados.

### VisionAnalysisResult

Contrato minimo:

```ts
type VisionAnalysisResult = {
  schemaVersion: "vision.v1";
  subject: {
    type: "producto" | "persona" | "comida" | "lugar" | "animal" | "objeto";
    description: string;
    hasPerson: boolean;
  };
  composition: {
    framing: "primer_plano" | "plano_medio" | "plano_general" | "detalle" | "cenital";
    angle: "frontal" | "picado" | "contrapicado" | "lateral" | "cenital";
    backgroundType: "limpio" | "natural" | "urbano" | "interior" | "exterior" | "abstracto";
    backgroundDescription: string;
    lighting: "natural" | "artificial" | "mixta" | "baja_luz" | "contraluz";
  };
  palette: {
    dominantColors: string[];
    temperature: "calida" | "neutra" | "fria" | "vibrante" | "oscura";
    saturation: number;
    contrast: number;
  };
  sensitiveElements: {
    priceVisible: boolean;
    logoVisible: boolean;
    personVisible: boolean;
    promotionVisible: boolean;
    textVisible: boolean;
    notes: string[];
  };
  technicalQuality: {
    sharpness: number;
    exposure: number;
    noise: number;
  };
  mood: {
    temperature: "calida" | "neutra" | "fria" | "vibrante" | "oscura";
    keywords: string[];
    description: string;
  };
  summary: string;
};
```

Reglas:

- `sensitiveElements` alimenta autonomia y aprobacion.
- Si hay precio/texto visible, no inventar promociones.
- Si hay persona, no alterar identidad.

### Variant

Resultado generado por IA para una foto.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID de variante. |
| `workspaceId` | string | Workspace. |
| `businessId` | string | Negocio. |
| `batchId` | string | Lote propietario. |
| `photoId` | string | Foto original. |
| `styleId` | string | Estilo asignado a esta variante. |
| `assignedStyle` | AssignedStyle nullable | Snapshot de decision de estilo. |
| `generationPlan` | GenerationPlan | Plan de seguridad/prompt. |
| `modelProfileId` | string nullable | Perfil de modelo usado para esta generacion. |
| `promptTemplateId` | string nullable | Template versionado usado. |
| `promptVersion` | string nullable | Version exacta del prompt. |
| `aiRunId` | string nullable | Auditoria de llamada IA principal. |
| `qualityCheckId` | string nullable | Resultado de compuerta de calidad. |
| `qualityStatus` | "pass" \| "warn" \| "block" nullable | Resultado operativo de calidad. |
| `qualityScore` | number nullable | Score normalizado 0-1. |
| `qualityWarnings` | string[] nullable | Advertencias visibles para revision interna. |
| `promptUsed` | string nullable | Deprecated/debug temporal. Preferir `aiRunId`, hashes y `promptVersion`; no persistir en produccion salvo TTL seguro. |
| `imageUrl` | string nullable | Imagen generada. |
| `generatedAssetId` | string nullable | MediaAsset generado privado. |
| `publishableAssetId` | string nullable | MediaAsset listo para Meta. |
| `caption` | string nullable | Texto editable. |
| `status` | VariantStatus | Estado. |
| `createdAt` | ISO string | Creacion. |
| `updatedAt` | ISO string | Actualizacion. |

Estados:

| Estado | Significado | Acciones |
| --- | --- | --- |
| `pendiente` | Todavia no inicia. | Generar. |
| `generando` | IA trabajando. | Esperar/cancelar lote. |
| `generada` | Lista para revisar. | Aprobar, rechazar, editar caption. |
| `fallida` | Generacion fallo. | Mostrar causa sanitizada, reintentar si se implementa. |
| `aprobada` | Usuario la acepto. | Calendario. |
| `rechazada` | Usuario la rechazo. | No programar. |
| `programada` | Ya tiene scheduled post. | Ver calendario. |
| `publicada` | Ya llego a Facebook. | Ver metricas. |
| `eliminada` | Cerrada por cancelacion o limpieza. | Solo lectura/oculta. |

Regla critica:

El estilo se asigna por variante. Nunca se debe asumir que todas las variantes de una foto comparten estilo.

### AssignedStyle

```ts
type AssignedStyle = {
  styleId: string;
  styleName: string;
  intensity: "ligera" | "media" | "fuerte";
  contrast: number;
  saturation: number;
  warmth: number;
  sharpness: number;
  lowConfidence: boolean;
  manualOverride: boolean;
};
```

Uso:

- Mostrar nombre de estilo en revision.
- Guardar snapshot para reproducibilidad.
- Alimentar aprendizaje.

### GenerationPlan

```ts
type GenerationPlan = {
  schemaVersion: "generation_plan.v1";
  puedeGenerar: boolean;
  motivo: string;
  sujetoPrincipal: string;
  preservar: string[];
  permitido: string[];
  prohibido: string[];
  riesgo: string[];
  nivelRiesgo: "riesgo_bajo" | "riesgo_medio" | "riesgo_alto";
  divulgacionIa: "no_requerida" | "recomendada" | "obligatoria";
  identityPolicy: "preservar" | "no_aplica" | "bloquear";
  textPolicy: "preservar_texto_visible" | "evitar_texto_nuevo" | "no_aplica";
  brandPolicy: "preservar_logos" | "sin_logos" | "no_aplica";
  commercialClaimPolicy: "no_inventar_claims" | "claims_permitidos_por_negocio";
  requiresHumanReview: boolean;
  promptFinal: string;
  promptVersion: string;
  planVersion: string;
};
```

Reglas:

- Si `puedeGenerar` es false, no llamar proveedor de imagen.
- `promptFinal` no se muestra al usuario final.
- `prohibido` debe incluir no cambiar producto real, logos, precios ni texto visible.
- `requiresHumanReview` debe ser true si hay personas visibles, precios/promociones, logos sensibles, texto legal o baja confianza.

### ModelProfile

Perfil versionado para elegir modelo y parametros por tarea sin editar logica de producto.

```ts
type ModelProfile = {
  id: string;
  task: "vision" | "generation_plan" | "caption" | "image_generation" | "ranking" | "weekly_report" | "eval";
  provider: "openai";
  primaryModel: string;
  fallbackModel?: string;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  textVerbosity?: "low" | "medium" | "high";
  imageQuality?: "low" | "medium" | "high";
  outputSchemaVersion?: string;
  timeoutMs: number;
  maxEstimatedCostUsd?: number;
  batchAllowed: boolean;
  status: "draft" | "canary" | "active" | "retired";
  createdAt: ISODateString;
  updatedAt: ISODateString;
};
```

### PromptTemplate

```ts
type PromptTemplate = {
  id: string;
  task: ModelProfile["task"];
  version: string;
  status: "draft" | "canary" | "active" | "retired";
  stableInstructions: string;
  variableContract: Record<string, unknown>;
  outputSchemaVersion: string;
  ownerUserId?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};
```

Regla: `stableInstructions` puede persistirse; datos de negocio/foto/contexto no deben mezclarse aqui.

### AiRun

Auditoria minima de cada llamada IA.

```ts
type AiRun = {
  id: string;
  workspaceId: string;
  businessId?: string;
  batchId?: string;
  photoId?: string;
  variantId?: string;
  jobId?: string;
  operationKey?: string;
  provider: "openai";
  task: ModelProfile["task"];
  modelProfileId: string;
  promptTemplateId?: string;
  promptVersion?: string;
  schemaVersion?: string;
  inputHash: string;
  outputHash?: string;
  responseId?: string;
  status: "started" | "succeeded" | "failed" | "refused" | "incomplete";
  usage?: Record<string, unknown>;
  cachedTokens?: number;
  estimatedCostUsd?: number;
  latencyMs?: number;
  safetyFlags?: string[];
  errorCode?: string;
  requestId?: string;
  traceId?: string;
  createdAt: ISODateString;
};
```

Reglas:

- No guardar prompt completo ni base64 en `AiRun`.
- `inputHash` y `outputHash` permiten reproducibilidad/auditoria sin exponer contenido sensible.
- Si se activa modo debug, el payload crudo debe vivir en storage privado con expiracion corta y referencia separada.

### AiQualityCheck

```ts
type AiQualityCheck = {
  id: string;
  workspaceId: string;
  variantId: string;
  aiRunId?: string;
  schemaVersion: "ai_quality_check.v1";
  status: "pass" | "warn" | "block";
  score: number;
  warnings: string[];
  blockingReasons: string[];
  requiresHumanReview: boolean;
  createdAt: ISODateString;
};
```

### AiEvaluation

```ts
type AiEvaluation = {
  id: string;
  task: ModelProfile["task"];
  datasetId: string;
  modelProfileId: string;
  promptTemplateId?: string;
  promptVersion?: string;
  baselineEvaluationId?: string;
  status: "queued" | "running" | "passed" | "failed" | "cancelled";
  metrics: Record<string, number>;
  reportUrl?: string;
  createdAt: ISODateString;
};
```

### ScheduledPost

Publicacion programada o publicada.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID interno. |
| `variantId` | string | Variante fuente. |
| `workspaceId` | string | Workspace. |
| `businessId` | string | Negocio. |
| `batchId` | string | Lote. |
| `scheduledFor` | ISO string | Fecha/hora programada. |
| `facebookPostId` | string nullable | ID real de Meta despues de publicar. |
| `remotePostType` | "photo" \| "feed" \| "unknown" nullable | Tipo de objeto remoto Meta. |
| `remotePostUrl` | string nullable | Permalink/URL de Meta si existe. |
| `deliveryMode` | "local_due_publish" \| "remote_schedule" \| "publish_now" | Como se envia a Meta. |
| `graphApiVersion` | string nullable | Version Graph usada para crear/sincronizar. |
| `publishLeadSeconds` | number nullable | Margen operativo para jobs locales. |
| `scheduledForUnix` | number nullable | Timestamp usado ante Meta si aplica. |
| `status` | ScheduledPostStatus | Estado. |
| `remoteStatus` | ScheduledPostRemoteStatus | Estado de sincronizacion con Meta. |
| `retryCount` | number | Intentos. |
| `lastRemoteSyncAt` | ISO string nullable | Ultima lectura/reconciliacion con Meta. |
| `remoteErrorCode` | string nullable | Ultimo codigo Meta sanitizado. |
| `remoteTraceId` | string nullable | `fbtrace_id` o equivalente, solo para soporte. |
| `caption` | string nullable | Derivado de variante para UI. |
| `imageUrl` | string nullable | Imagen final. |
| `styleId` | string nullable | Estilo. |
| `styleName` | string nullable | Nombre de estilo. |
| `createdAt` | ISO string | Alta. |
| `updatedAt` | ISO string | Ultima modificacion. |

Estados:

| Estado | Significado | Acciones |
| --- | --- | --- |
| `pendiente` | Aun no confirmado. | Confirmar calendario. |
| `programada` | Espera hora. | Editar fecha, cancelar, publicar ahora. |
| `publicacion_en_proceso` | Worker/API publicando. | Bloquear edicion temporal. |
| `publicada` | Meta devolvio ID. | Ver resultado/metricas. |
| `estado_incierto` | No se sabe si Meta publico. | No duplicar sin revisar. |
| `fallida` | Error no relacionado a token. | Reintentar. |
| `pausada_por_token` | Falta/expira token. | Reconexion primero. |
| `cancelada` | Cancelada localmente si nunca llego a Meta, o cancelada tambien en Meta si ya estaba confirmada remotamente. | Solo lectura. |

Regla anti-duplicados:

- Si `facebookPostId` existe, no publicar otra vez.
- Si estado es `estado_incierto`, el sistema debe pedir verificacion antes de reintentar.
- Si `remoteStatus` indica `confirmado_meta`, editar/cancelar debe sincronizar Meta o quedar como `estado_incierto`.
- Un post con `remoteStatus = confirmado_meta` no puede pasar a `cancelada` hasta confirmar cancelacion remota.

`ScheduledPostRemoteStatus`:

- `no_enviado`
- `confirmado_meta`
- `actualizacion_pendiente`
- `cancelacion_pendiente`
- `incierto`

Reglas de `deliveryMode`:

- `local_due_publish`: DB agenda, worker publica en Meta cuando llega la hora.
- `remote_schedule`: Meta recibe `scheduled_publish_time` y mantiene el post programado remoto.
- `publish_now`: accion manual inmediata.
- El cliente no decide `deliveryMode`; backend lo deriva de capacidades de pagina, config y estado.

### MetaPublishingCapability

Capacidad operativa comprobada por pagina/version Graph.

```ts
type MetaPublishingCapability = {
  id: string;
  workspaceId: string;
  facebookPageId: string;
  graphApiVersion: string;
  canPublishPhoto: boolean;
  canRemoteSchedulePhoto: boolean;
  canDeleteRemotePost: boolean;
  canReadScheduledPosts: boolean;
  preferredDeliveryMode: "local_due_publish" | "remote_schedule";
  lastProbeAt?: ISODateString;
  lastProbeResult?: "passed" | "failed" | "partial";
  lastErrorCode?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};
```

Regla: si no existe capacidad vigente o `lastProbeResult` no es `passed`, usar `local_due_publish`.

### MetricDefinition

Catalogo versionado de metricas internas y de proveedor.

```ts
type MetricDefinition = {
  id: string;
  provider: "fbmaniaco" | "meta";
  canonicalMetric:
    | "views"
    | "engagements"
    | "reactions"
    | "comments"
    | "shares"
    | "clicks"
    | "publish_success"
    | "publish_failure"
    | "approval_rate"
    | "caption_edit_rate"
    | "week_coverage";
  providerMetricName?: string;
  graphApiVersion?: string;
  valueType: "count" | "rate" | "duration" | "currency";
  status: "active" | "deprecated" | "unavailable";
  effectiveFrom: ISODateString;
  effectiveTo?: ISODateString;
  notes?: string;
};
```

Reglas:

- Una metrica canonica puede tener varios nombres remotos en el tiempo.
- Si Meta depreca una metrica, se marca `deprecated`; no se borra historia.
- Los summaries deben leer por `canonicalMetric`, no por nombre remoto.

### PostMetricSnapshot

Valor observado para un post en una ventana comparable.

```ts
type PostMetricSnapshot = {
  id: string;
  workspaceId: string;
  businessId: string;
  scheduledPostId: string;
  facebookPostId?: string;
  metricDefinitionId: string;
  provider: "fbmaniaco" | "meta";
  canonicalMetric: MetricDefinition["canonicalMetric"];
  providerMetricName?: string;
  window: "24h" | "72h" | "7d" | "lifetime";
  value: number;
  collectedAt: ISODateString;
  observedUntil: ISODateString;
  collectionStatus: "ok" | "partial" | "unavailable" | "deprecated" | "permission_error";
  sourceVersion?: string;
  rawRef?: string;
};
```

Reglas:

- Snapshots son append-only. Si se corrige un valor, crear snapshot nuevo.
- No comparar `24h` contra `lifetime`.
- `rawRef` puede apuntar a diagnostico privado temporal, nunca a payload crudo publico.

### PerformanceSummary

Resumen recalculable para dashboard, memoria y reporte.

```ts
type PerformanceSummary = {
  id: string;
  workspaceId: string;
  businessId: string;
  scope: "business_week" | "style" | "time_slot" | "caption_pattern" | "content_type";
  scopeKey: string;
  periodStart: ISODateString;
  periodEnd: ISODateString;
  sampleSize: number;
  metrics: Record<string, number>;
  confidence: "exploratoria" | "media" | "alta";
  reasonCodes: string[];
  generatedAt: ISODateString;
};
```

Reglas:

- `sampleSize < 20` fuerza `confidence = exploratoria`.
- El summary no es fuente primaria; se puede recalcular desde eventos y snapshots.
- Reportes y ranking deben mostrar/usar `confidence`.

### Job

Trabajo asincrono, reintentable y auditable.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID del job. |
| `type` | JobType | Tipo de trabajo. |
| `status` | JobStatus | Estado. |
| `workspaceId` | string | Workspace. |
| `businessId` | string nullable | Negocio. |
| `batchId` | string nullable | Lote. |
| `photoId` | string nullable | Foto. |
| `variantId` | string nullable | Variante. |
| `scheduledPostId` | string nullable | Publicacion. |
| `dedupeKey` | string | Clave anti-duplicados. |
| `payload` | object nullable | Entrada sanitizada. |
| `result` | object nullable | Salida sanitizada. |
| `requestId` | string nullable | Trazabilidad de la peticion original. |
| `idempotencyKey` | string nullable | Clave idempotente que creo o reclamo el job. |
| `operationKey` | string nullable | Clave estable del side effect externo, si aplica. |
| `leaseExpiresAt` | ISO string nullable | Vencimiento del lease/visibility esperado. |
| `nextRetryAt` | ISO string nullable | Proximo reintento calculado. |
| `lastAttemptId` | string nullable | Ultimo intento registrado. |
| `attempts` | number | Intentos usados. |
| `maxAttempts` | number | Intentos maximos. |
| `runAfter` | ISO string | No ejecutar antes de esta fecha. |
| `lockedAt` | ISO string nullable | Lock worker. |
| `lockedBy` | string nullable | Worker. |
| `lastError` | string nullable | Error sanitizado. |
| `createdAt` | ISO string | Alta. |
| `updatedAt` | ISO string | Cambio. |

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

- `dedupeKey` debe ser unico por tipo de job activo.
- `dedupeKey` debe ser deterministico, no aleatorio.
- `operationKey` identifica el side effect externo: por ejemplo `meta_publish:{scheduledPostId}`, `meta_cancel:{scheduledPostId}:{remotePostId}`, `meta_sync:{scheduledPostId}:{remotePostId}` u `openai_image:{variantId}`.
- `publish_post` bloquea si existe `facebookPostId` o si el post esta `estado_incierto` sin reconciliar.
- Cancelar lote cancela jobs pendientes del lote.
- Jobs no deben guardar tokens ni payloads crudos de proveedores.
- Si se usa Supabase Queues/PGMQ, el mensaje de cola debe contener solo `jobId` y datos minimos; el detalle vive en `jobs`.
- Un job `running` vencido solo puede volver a `queued` si no inicio side effect externo. Si ya inicio, pasa por reconciliacion antes de reintentar.
- La reconciliacion se ejecuta como job explicito `reconcile_external_operation` con `dedupeKey = operationKey`; no debe esconderse dentro de un retry manual.
- Los reintentos usan backoff exponencial con jitter y limite por tipo.
- Errores permanentes pasan a `failed`, errores por permisos pasan a `blocked` o `needs_user_action`, errores ambiguos pasan a entidad destino en `estado_incierto`.

### JobAttempt

Registro de cada intento real de un job. Evita perder informacion cuando un worker cae despues de llamar a un proveedor.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID del intento. |
| `jobId` | string | Job. |
| `workspaceId` | string | Workspace. |
| `attemptNumber` | number | Numero de intento. |
| `status` | `started`, `provider_started`, `provider_succeeded`, `provider_failed`, `succeeded`, `failed`, `ambiguous` | Estado del intento. |
| `operationKey` | string nullable | Side effect externo asociado. |
| `provider` | string nullable | Meta/OpenAI/Supabase/etc. |
| `providerRequestId` | string nullable | ID de request/respuesta si el proveedor lo entrega. |
| `providerResourceId` | string nullable | ID externo creado, por ejemplo post Meta. |
| `startedAt` | ISO string | Inicio. |
| `finishedAt` | ISO string nullable | Fin. |
| `lastError` | string nullable | Error sanitizado. |

Reglas:

- Crear `JobAttempt` antes de llamar a Meta/OpenAI/Supabase.
- Marcar `provider_started` inmediatamente antes de la llamada externa.
- Si el worker cae despues de `provider_started`, el job no se reintenta a ciegas; entra a reconciliacion.
- El payload no guarda tokens, imagenes base64 ni respuestas crudas completas.

### ExternalOperation

Ledger de side effects externos. Su objetivo es evitar repetir llamadas no idempotentes o saber cuando una llamada quedo ambigua.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `operationKey` | string | Clave unica del side effect. |
| `workspaceId` | string | Workspace. |
| `jobId` | string nullable | Job origen. |
| `provider` | string | Meta/OpenAI/Supabase/etc. |
| `operation` | string | publish_post, generate_image, upload_media, etc. |
| `status` | `pending`, `started`, `succeeded`, `failed`, `ambiguous`, `reconciled` | Estado. |
| `providerRequestId` | string nullable | ID proveedor si existe. |
| `providerResourceId` | string nullable | Recurso externo creado. |
| `idempotencyKeySent` | string nullable | Clave enviada al proveedor si la API la soporta. |
| `createdAt` | ISO string | Alta. |
| `updatedAt` | ISO string | Cambio. |

Reglas:

- `operationKey` es unico.
- Si el proveedor soporta idempotency key, enviar `operationKey` o derivado estable.
- Si el proveedor no soporta idempotency key, usar `ExternalOperation` + checks de entidad antes/despues + reconciliacion.
- Para Meta, reconciliar consultando `facebookPostId`, posts programados/publicados recientes y estado remoto antes de crear otro post.
- Para OpenAI/imagenes, no repetir generacion si `variant.imageUrl` ya existe; si el resultado externo fue ambiguo y no hay imagen guardada, marcar variante/job para reintento consciente y registrar costo potencial.
- La reconciliacion debe dejar `status = reconciled` solo cuando actualizo la entidad destino con un resultado comprobado; si no puede comprobarlo, conserva `ambiguous` y pide accion humana.

### IdempotencyRecord

Registro para repetir mutaciones sin duplicar jobs, costos ni publicaciones.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID interno. |
| `workspaceId` | string | Workspace. |
| `actorId` | string nullable | Usuario/actor. |
| `method` | string | Metodo HTTP. |
| `routeKey` | string | Ruta normalizada, no URL cruda con secretos. |
| `idempotencyKey` | string | Header enviado por cliente. |
| `requestHash` | string | Hash del body sanitizado. |
| `response` | object nullable | Respuesta confirmada o referencia a job. |
| `status` | `processing`, `succeeded`, `failed` | Estado. |
| `createdAt` | ISO string | Alta. |
| `expiresAt` | ISO string | Vencimiento de retencion. |

Reglas:

- La API reserva la key en estado `processing` dentro de la misma transaccion que valida el comando.
- Si llega la misma key mientras esta `processing`, responder la entidad/job existente o 409/202 con `userMessage` de operacion en curso, no crear trabajo nuevo.
- Si llega la misma key con distinto `requestHash`, responder 409.
- Si la primera ejecucion ya guardo `succeeded` o `failed` con side effect confirmado, devolver el mismo status code/body sanitizado.
- Retener al menos 24 horas para acciones costosas; mas para publicaciones si hay riesgo de duplicado.
- Retener keys de publicacion/programacion al menos 30 dias o durante la vida del scheduled post.
- No guardar tokens, data URLs ni payloads crudos en `response`.

### StateTransition

Registro auditable de cambios de estado criticos. Puede implementarse como evento en `events`/`outbox_events`, pero el payload debe respetar este contrato.

```ts
type StateTransition = {
  schemaVersion: "state_transition.v1";
  entityType: "batch" | "photo" | "variant" | "scheduled_post" | "job" | "business" | "facebook_page";
  entityId: string;
  workspaceId: string;
  businessId?: string;
  fromStatus?: string | null;
  toStatus: string;
  reasonCode: string;
  actorId?: string | null;
  requestId?: string | null;
  jobId?: string | null;
  occurredAt: string;
};
```

Reglas:

- Todo cambio de `Batch.status`, `Variant.status`, `ScheduledPost.status`, `ScheduledPost.remoteStatus` y `Job.status` debe poder reconstruirse desde eventos o logs persistidos.
- No registrar secretos ni payloads completos de proveedor.
- `reasonCode` debe ser estable: `user_cancelled`, `worker_succeeded`, `meta_token_expired`, `remote_cancel_failed`, etc.

### PricingRule

Define precios vigentes por proveedor/modelo/operacion.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID de regla. |
| `provider` | string | OpenAI, Meta u otro. |
| `model` | string | Modelo o SKU. |
| `operation` | string | vision, image_generation, caption, report, etc. |
| `unitType` | `token`, `image`, `request`, `post`, `month`, `credit_usd` | Unidad medida. |
| `unitSize` | number | Tamano de la unidad, por ejemplo 1 o 1000000 tokens. |
| `dimensions` | object nullable | Calidad, tamano, tier, region o flags que cambian precio. |
| `currency` | string | Moneda, default USD. |
| `unitCostUsd` | number | Costo interno estimado por unidad. |
| `customerUnitPriceUsd` | number | Precio cobrado/mostrado por unidad. |
| `priceVersion` | string | Version auditable. |
| `effectiveFrom` | ISO string | Inicio de vigencia. |
| `effectiveTo` | ISO string nullable | Fin de vigencia. |
| `active` | boolean | Si se usa para nuevas estimaciones. |

Reglas:

- Las reglas se actualizan por migracion/admin interno, no por cliente.
- Una version de precio nunca se edita retroactivamente; se crea otra `priceVersion`.
- `dimensions` debe distinguir modelo, calidad, tamano, batch/flex y cualquier factor que altere costo real.
- El margen se protege comparando `customerUnitPriceUsd` contra `unitCostUsd` y contra un minimo configurable por operacion.

### UsageMeter

Contador mensual de uso y reservas por workspace. Sirve para bloquear antes de gastar y para conciliar contra billing.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID. |
| `workspaceId` | string | Workspace. |
| `metric` | `photo_uploads`, `generated_variants`, `scheduled_posts`, `ai_customer_spend_usd`, `ai_provider_cost_usd` | Metrica. |
| `periodStart` | ISO string | Inicio de periodo. |
| `periodEnd` | ISO string | Fin de periodo. |
| `limitValue` | number nullable | Limite aplicable. |
| `reservedValue` | number | Uso reservado por jobs no cerrados. |
| `usedValue` | number | Uso confirmado. |
| `updatedAt` | ISO string | Cambio. |

Reglas:

- Debe existir unicidad por `workspaceId + metric + periodStart`.
- La reserva se hace con row lock/transaccion; si excede limite, no se crean jobs.
- Al completar job, `reservedValue` baja y `usedValue` sube.
- Si el job falla antes de consumir proveedor, se libera reserva.
- Si el proveedor consumio costo parcial, se registra usado y se libera solo el remanente.

### BillingProviderEvent

Registro idempotente de webhooks de cobro.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID interno. |
| `provider` | `stripe`, `mercado_pago` | Proveedor. |
| `providerEventId` | string | ID externo del evento. |
| `workspaceId` | string nullable | Workspace resuelto. |
| `type` | string | Tipo de evento. |
| `status` | `received`, `processed`, `ignored`, `failed` | Estado. |
| `receivedAt` | ISO string | Recepcion. |
| `processedAt` | ISO string nullable | Procesado. |
| `lastError` | string nullable | Error sanitizado. |

Reglas:

- `provider + providerEventId` es unico.
- Los webhooks actualizan `BillingAccount`, `Workspace.plan`, `billingStatus` y `entitlements`; no llaman IA ni publican.
- Si hay duda o evento fuera de orden, conservar el estado mas restrictivo hasta reconciliar con API del proveedor.

### AuditLog

Registro persistente de acciones humanas o cambios administrativos sensibles. No reemplaza logs tecnicos ni eventos de dominio.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID. |
| `workspaceId` | string | Workspace. |
| `actorId` | string nullable | Usuario/actor. |
| `action` | string | Accion estable: `meta_connected`, `batch_cancelled`, `billing_updated`, etc. |
| `entityType` | string | Tipo de entidad afectada. |
| `entityId` | string nullable | Entidad afectada. |
| `requestId` | string nullable | Request origen. |
| `jobId` | string nullable | Job relacionado. |
| `before` | object nullable | Estado anterior sanitizado, solo campos permitidos. |
| `after` | object nullable | Estado posterior sanitizado, solo campos permitidos. |
| `ipHash` | string nullable | Hash de IP si se conserva. |
| `userAgentHash` | string nullable | Hash de user agent si se conserva. |
| `createdAt` | ISO string | Alta. |

Reglas:

- No guardar tokens, prompts completos, imagenes base64, headers ni payloads crudos.
- Retencion minima recomendada: 180 dias para soporte/compliance operacional.
- Acciones de billing, conexion Meta, cambio de permisos, publicaciones, cancelaciones y cambios de plan deben dejar audit log.

### ObservabilityEvent

Evento tecnico normalizado para logs estructurados, Sentry/OpenTelemetry y diagnostico. Puede vivir fuera de DB en el colector, pero este contrato define los campos permitidos.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `timestamp` | ISO string | Momento. |
| `level` | `debug`, `info`, `warn`, `error`, `fatal` | Severidad. |
| `service` | `mobile`, `api`, `worker`, `provider` | Origen. |
| `environment` | string | dev/staging/prod. |
| `release` | string | Version/build. |
| `requestId` | string nullable | Correlacion HTTP. |
| `traceId` | string nullable | Correlacion distribuida. |
| `workspaceId` | string nullable | Workspace. |
| `actorId` | string nullable | Usuario. |
| `businessId` | string nullable | Negocio. |
| `batchId` | string nullable | Lote. |
| `jobId` | string nullable | Job. |
| `provider` | string nullable | Meta/OpenAI/Supabase/Stripe/etc. |
| `operation` | string nullable | Operacion tecnica. |
| `durationMs` | number nullable | Duracion. |
| `status` | string nullable | Resultado. |
| `errorCode` | string nullable | Codigo estable sanitizado. |
| `message` | string | Mensaje sanitizado. |

Reglas:

- `requestId` debe viajar de app -> API -> job -> provider logs.
- `traceId` debe propagarse cuando haya tracing; si no existe, `requestId` sigue siendo obligatorio.
- Eventos de proveedor registran codigo/clase de error, latencia, modelo/version y costos/usage sanitizados, no payload crudo.

### PrivacyRequest

Solicitud de exportacion o eliminacion de datos por workspace/usuario.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID. |
| `workspaceId` | string | Workspace. |
| `actorId` | string | Solicitante. |
| `type` | `export`, `delete_workspace`, `delete_media`, `anonymize` | Tipo. |
| `status` | `requested`, `processing`, `completed`, `failed`, `cancelled` | Estado. |
| `requestedAt` | ISO string | Solicitud. |
| `completedAt` | ISO string nullable | Cierre. |
| `exportUrl` | string nullable | URL temporal si aplica. |
| `expiresAt` | ISO string nullable | Caducidad de export. |

Reglas:

- Solo `owner` puede pedir exportacion/eliminacion completa del workspace.
- Exportaciones son temporales, privadas y no deben incluir tokens ni prompts completos.
- Eliminacion de workspace debe borrar o anonimizar media, jobs, eventos y datos comerciales segun retencion legal/operativa.
- Toda solicitud escribe `audit_logs`.

### UploadIntent

Intencion temporal para subir archivo directo a Storage sin pasar binario por la API.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID. |
| `workspaceId` | string | Workspace. |
| `businessId` | string | Negocio. |
| `batchId` | string | Lote. |
| `photoId` | string nullable | Foto creada al completar. |
| `bucket` | string | Bucket destino privado. |
| `storageKey` | string | Key no enumerable. |
| `allowedMimeTypes` | string[] | Tipos permitidos. |
| `maxBytes` | number | Limite. |
| `status` | `created`, `uploaded`, `completed`, `expired`, `failed` | Estado. |
| `expiresAt` | ISO string | Vencimiento. |
| `createdAt` | ISO string | Alta. |

Reglas:

- `uploadUrl` firmado no se persiste; solo se devuelve al cliente.
- `storageKey` incluye workspace/batch y un ID aleatorio, no nombre original.
- `complete-upload` verifica existencia, tamano, MIME real, hash y que el intent no haya vencido.
- Para archivos grandes o red inestable, usar upload resumable/TUS con token firmado.

### MediaAsset

Registro canonico de objetos de Storage y derivados.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID. |
| `workspaceId` | string | Workspace. |
| `businessId` | string nullable | Negocio. |
| `batchId` | string nullable | Lote. |
| `photoId` | string nullable | Foto origen. |
| `variantId` | string nullable | Variante relacionada. |
| `scheduledPostId` | string nullable | Publicacion relacionada. |
| `kind` | `original`, `thumbnail`, `vision_input`, `generated`, `publishable` | Tipo. |
| `bucket` | string | Bucket. |
| `storageKey` | string | Key Storage. |
| `publicUrl` | string nullable | URL publica/controlada si aplica. |
| `signedUrlExpiresAt` | ISO string nullable | Expiracion si es URL firmada. |
| `mimeType` | string | MIME confirmado. |
| `bytes` | number | Tamano. |
| `width` | number nullable | Ancho. |
| `height` | number nullable | Alto. |
| `contentHash` | string | Hash de contenido. |
| `status` | `private`, `processing`, `ready`, `publicable`, `published`, `deleted` | Estado. |
| `metadata` | object nullable | EXIF sanitizado/derivados. |
| `createdAt` | ISO string | Alta. |

Reglas:

- `Photo.storageKey` y `Variant.imageUrl` pueden existir por conveniencia, pero `media_assets` es la cadena de custodia.
- Originales y thumbnails privados no usan `publicUrl` persistente.
- Antes de publicar en Meta, debe existir asset `publishable` con URL HTTPS accesible por Meta.
- El worker debe hacer HEAD/GET ligero de la URL publicable antes de llamar Meta.
- Derivados deben normalizar orientacion EXIF, remover metadata sensible y producir formatos compatibles.

### CostLedger

Registra costo real o estimado consumido por job/lote.

Campos:

| Campo | Tipo | Descripcion |
| --- | --- | --- |
| `id` | string | ID del movimiento. |
| `workspaceId` | string | Workspace. |
| `businessId` | string nullable | Negocio. |
| `batchId` | string nullable | Lote. |
| `jobId` | string nullable | Job relacionado. |
| `operationKey` | string nullable | Side effect/costo externo que origino el cargo. |
| `entryType` | `reservation`, `actual`, `adjustment`, `release` | Tipo de movimiento. |
| `status` | `reserved`, `posted`, `released`, `void` | Estado contable interno. |
| `usageMetric` | string nullable | Metrica afectada en `usage_meters`. |
| `provider` | string | Proveedor. |
| `model` | string | Modelo usado. |
| `operation` | string | Operacion facturable. |
| `quantity` | number | Cantidad. |
| `providerCostUsd` | number | Costo interno. |
| `customerPriceUsd` | number | Precio confirmado/cargado al usuario. |
| `priceVersion` | string | Version de pricing aplicada. |

Reglas:

- `estimate-cost` lee `pricing_rules`.
- `confirm-cost` guarda version/desglose en el lote y crea reservas en `cost_ledger`/`usage_meters`.
- Cada job facturable escribe `cost_ledger` al completarse o fallar con consumo parcial.
- `operationKey + entryType` debe ser unico cuando exista; si el proveedor fue ambiguo, el reintento consciente reutiliza la misma clave o registra un ajuste separado con razon auditable.
- Los cargos al cliente se calculan desde movimientos `posted`; las reservas no son ingreso ni factura.
- Si cambia pricing despues de confirmar, el lote mantiene `confirmedPriceVersion`.

## Eventos de aprendizaje

Tipos:

| Tipo | Cuando ocurre | Uso |
| --- | --- | --- |
| `variante_generada` | IA creo variante. | Medir estilos usados. |
| `variante_aprobada` | Usuario aprueba. | Aprender preferencias. |
| `variante_rechazada` | Usuario rechaza. | Evitar patrones. |
| `estilo_cambiado_por_usuario` | Usuario edita estilo. | Respetar control manual. |
| `caption_editado_por_usuario` | Usuario cambia copy. | Aprender tono. |
| `post_publicado` | Meta acepta publicacion. | Medir exito. |
| `post_fallido` | Publicacion falla. | Diagnostico. |
| `metricas_recolectadas` | Se importan metricas. | Memoria. |
| `metrica_no_disponible` | Meta rechaza o depreca una metrica. | Degradar reportes sin romper jobs. |
| `performance_summary_generado` | Se recalcula summary. | Reportes/ranking. |
| `accion_aprobada_en_swipe_autonomia` | Usuario autoriza accion IA. | Subir confianza. |
| `accion_rechazada_en_swipe_autonomia` | Usuario rechaza accion IA. | Bajar confianza. |
| `batch_abandoned` | Lote viejo/inactivo. | Limpieza. |

Campos minimos:

```ts
type LearningEvent = {
  id: string;
  workspaceId: string;
  businessId: string;
  type: string;
  occurredAt: string;
  actor?: "user" | "system" | "worker" | "provider";
  sourceModule?: string;
  batchId?: string;
  photoId?: string;
  variantId?: string;
  scheduledPostId?: string;
  styleId?: string;
  styleName?: string;
  photoType?: string;
  captionPattern?: string;
  score?: number;
  scheduledFor?: string;
  errorMessage?: string;
  payload?: Record<string, unknown>;
};
```

## Transiciones permitidas

### Batch

```txt
pending_upload
  -> pendiente_confirmacion
  -> confirmado
  -> generando
  -> generado_parcial
  -> completado
```

Transiciones laterales:

```txt
pending_upload -> cancelado | abandonado
pendiente_confirmacion -> cancelado | abandonado
confirmado -> cancelado | abandonado
generando -> cancelado | fallido
generado_parcial -> cancelado | completado | fallido
```

Bloqueos:

- `cancelado` no vuelve a `generando`.
- `completado` no acepta nuevas fotos.
- `fallido` requiere ruta explicita de reintento si se agrega.

### Variant

```txt
pendiente -> generando -> generada -> aprobada -> programada -> publicada
```

Alternas:

```txt
generando -> fallida
generada -> rechazada
generando -> eliminada si lote se cancela
aprobada -> eliminada si se reabre aprobacion antes de llegar a Meta
```

### ScheduledPost

```txt
pendiente -> programada -> publicacion_en_proceso -> publicada
```

Alternas:

```txt
programada -> cancelada si remoteStatus = no_enviado o cancelacion remota exitosa
programada -> estado_incierto si la edicion/cancelacion remota queda ambigua
publicacion_en_proceso -> pausada_por_token
publicacion_en_proceso -> fallida
publicacion_en_proceso -> estado_incierto
estado_incierto -> publicada si reconciliacion confirma publicacion Meta
estado_incierto -> programada si reconciliacion confirma que no se publico y se puede reintentar
estado_incierto -> fallida si reconciliacion confirma error definitivo
estado_incierto -> cancelada si reconciliacion confirma cancelacion/remocion remota
fallida -> programada por retry
pausada_por_token -> programada despues de reconexion
```

### Job

```txt
queued -> running -> succeeded
queued -> running -> failed
queued -> cancelled
running -> failed
running -> blocked
running -> needs_user_action
failed -> queued por retry
blocked -> queued despues de resolver causa
needs_user_action -> queued despues de aprobacion/reconexion
```

Bloqueos:

- `cancelled` no vuelve a `queued`.
- `succeeded` no se repite.
- Jobs con side effect externo irreversible no se reintentan sin revisar `dedupeKey` y entidad destino.

## Esquema Supabase recomendado

La reconstruccion completa debe usar Supabase/Postgres como fuente primaria. Ya no se recomienda tratar estas tablas como espejo planner opcional.

Tablas minimas:

- `users`
- `workspaces`
- `workspace_members`
- `billing_accounts`
- `billing_provider_events`
- `audit_logs`
- `privacy_requests`
- `media_assets`
- `upload_intents`
- `meta_authorizations`
- `facebook_pages`
- `meta_publishing_capabilities`
- `businesses`
- `visual_styles`
- `batches`
- `photos`
- `variants`
- `model_profiles`
- `prompt_templates`
- `ai_runs`
- `ai_quality_checks`
- `ai_evaluations`
- `scheduled_posts`
- `jobs`
- `job_attempts`
- `external_operations`
- `idempotency_records`
- `outbox_events`
- `events`
- `autonomy_state`
- `metric_definitions`
- `post_metric_snapshots`
- `performance_summaries`
- `pricing_rules`
- `usage_meters`
- `cost_ledger`

### `users`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | text primary key | ID interno. |
| `email` | text unique | Correo. |
| `display_name` | text nullable | Nombre. |
| `status` | text not null | activo/bloqueado/eliminado. |
| `created_at` | timestamptz | Alta. |
| `updated_at` | timestamptz | Cambio. |

### `workspaces`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | text primary key | ID. |
| `name` | text not null | Nombre. |
| `owner_user_id` | text not null | Dueno. |
| `plan` | text nullable | piloto/starter/pro/agency. |
| `billing_status` | text not null default `trial` | Estado comercial. |
| `entitlements` | jsonb default `{}` | Limites comerciales normalizados. |
| `status` | text not null | activo/pausado/eliminado. |
| `created_at` | timestamptz | Alta. |
| `updated_at` | timestamptz | Cambio. |

### `workspace_members`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `workspace_id` | text not null | Workspace. |
| `user_id` | text not null | Usuario. |
| `role` | text not null | owner/admin/operator/viewer. |
| `status` | text not null | active/invited/disabled. |
| `created_at` | timestamptz | Alta. |

### `billing_accounts`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | text primary key | ID interno. |
| `workspace_id` | text not null | Workspace. |
| `provider` | text not null | stripe/mercado_pago/manual. |
| `provider_customer_id` | text nullable | ID externo cliente. |
| `provider_subscription_id` | text nullable | ID externo suscripcion. |
| `provider_subscription_item_id` | text nullable | Item de uso medido, si aplica. |
| `provider_price_id` | text nullable | Precio/plan externo vigente. |
| `status` | text not null | trial/active/past_due/paused/cancelled. |
| `current_period_start` | timestamptz nullable | Inicio periodo. |
| `current_period_end` | timestamptz nullable | Fin periodo. |
| `created_at` | timestamptz | Alta. |
| `updated_at` | timestamptz | Cambio. |

### `billing_provider_events`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | text primary key | ID interno. |
| `provider` | text not null | stripe/mercado_pago. |
| `provider_event_id` | text not null | ID externo unico. |
| `workspace_id` | text nullable | Workspace resuelto. |
| `type` | text not null | Tipo de evento. |
| `status` | text not null | received/processed/ignored/failed. |
| `received_at` | timestamptz | Recepcion. |
| `processed_at` | timestamptz nullable | Procesado. |
| `last_error` | text nullable | Error seguro. |

### `facebook_pages`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | text primary key | ID interno. |
| `workspace_id` | text not null | Workspace. |
| `meta_authorization_id` | text nullable | Autorizacion Meta origen. |
| `meta_page_id` | text not null | ID externo Meta. |
| `page_name` | text not null | Nombre de pagina. |
| `page_access_token` | text nullable | Debe restringirse y cifrarse o protegerse server-side. |
| `page_access_token_key_id` | text nullable | Version de llave/referencia. |
| `last_token_use_at` | timestamptz nullable | Ultimo uso tecnico. |
| `category` | text nullable | Categoria. |
| `category_list` | jsonb default `[]` | Categorias. |
| `tasks` | jsonb default `[]` | Permisos/tareas. |
| `is_granted` | boolean default true | Concedida por permisos granulares. |
| `cover_photo_url` | text nullable | Thumbnail. |
| `page_access_token_status` | text nullable | Estado. |
| `granted_scopes` | jsonb default `[]` | Permisos concedidos. |
| `declined_scopes` | jsonb default `[]` | Permisos faltantes/rechazados. |
| `token_expires_at` | timestamptz nullable | Caducidad tecnica si aplica. |
| `last_debug_at` | timestamptz nullable | Ultima validacion con Meta. |
| `graph_api_version` | text nullable | Version Graph usada. |
| `is_selected` | boolean default false | Seleccion. |
| `updated_at` | timestamptz | Ultima sync. |

### `businesses`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | text primary key | ID interno. |
| `workspace_id` | text not null | Workspace. |
| `facebook_page_id` | text not null | Relacion a `facebook_pages.id` o ID externo validado por workspace en migracion legacy. |
| `name` | text | Nombre. |
| `industry` | text | Industria. |
| `timezone` | text | Zona horaria. |
| `token_status` | text | Estado Meta. |
| `metadata` | jsonb default `{}` | SEO, tono, preferencias. |
| `autonomy_settings` | jsonb default `{}` | Umbrales. |
| `created_at` | timestamptz | Alta. |
| `updated_at` | timestamptz | Cambio. |

### `batches`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | text primary key | ID. |
| `workspace_id` | text not null | Workspace. |
| `business_id` | text not null | FK logica a business. |
| `status` | text not null | BatchStatus. |
| `photos_count` | integer | Conteo. |
| `variants_count` | integer | Conteo. |
| `estimated_cost_usd` | double precision nullable | Estimacion al usuario. |
| `estimated_provider_cost_usd` | double precision nullable | Estimacion interna de proveedor. |
| `confirmed_cost_usd` | double precision nullable | Costo confirmado. |
| `confirmed_price_version` | text nullable | Version de regla de precios usada. |
| `confirmed_cost_breakdown` | jsonb nullable | Desglose sanitizado. |
| `last_activity_at` | timestamptz | Actividad. |
| `variants_per_photo` | integer default 1 | Variantes por foto. |
| `photo_ids` | jsonb default `[]` | IDs. |
| `variant_ids` | jsonb default `[]` | IDs. |
| `scheduled_post_ids` | jsonb default `[]` | IDs. |
| `created_at` | timestamptz | Alta. |
| `updated_at` | timestamptz | Cambio. |

### `photos`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | text primary key | ID. |
| `workspace_id` | text not null | Workspace. |
| `business_id` | text not null | Negocio. |
| `batch_id` | text not null | Lote. |
| `file_name` | text nullable | Archivo. |
| `storage_key` | text nullable | Storage. |
| `original_asset_id` | text nullable | MediaAsset original. |
| `thumbnail_asset_id` | text nullable | MediaAsset thumbnail. |
| `vision_input_asset_id` | text nullable | Derivado para vision. |
| `media_url` | text nullable | URL renderizable/controlada. |
| `thumbnail_url` | text nullable | Preview. |
| `content_hash` | text nullable | Hash de contenido. |
| `mime_type` | text nullable | Tipo confirmado. |
| `width` | integer nullable | Ancho. |
| `height` | integer nullable | Alto. |
| `status` | text not null | PhotoStatus. |
| `vision_analysis` | jsonb nullable | Analisis. |
| `created_at` | timestamptz | Alta. |
| `updated_at` | timestamptz | Cambio. |

Columnas antiguas opcionales:

- `assigned_style`: ya no debe usarse como fuente de verdad porque el estilo ahora vive por variante.
- `editing_prompt`: solo si se mantiene para auditoria historica.

### `variants`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | text primary key | ID. |
| `workspace_id` | text not null | Workspace. |
| `business_id` | text not null | Negocio. |
| `batch_id` | text not null | Lote. |
| `photo_id` | text not null | Foto. |
| `style_id` | text not null | Estilo por variante. |
| `assigned_style` | jsonb nullable | Snapshot recomendado. |
| `generation_plan` | jsonb nullable | Plan IA. |
| `prompt_used` | text nullable | Debug/backend. |
| `image_url` | text nullable | Imagen final. |
| `generated_asset_id` | text nullable | MediaAsset generado privado. |
| `publishable_asset_id` | text nullable | MediaAsset listo para Meta. |
| `caption` | text nullable | Copy. |
| `status` | text not null | VariantStatus. |
| `created_at` | timestamptz | Alta. |
| `updated_at` | timestamptz | Cambio. |

### `scheduled_posts`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | text primary key | ID. |
| `workspace_id` | text not null | Workspace. |
| `variant_id` | text not null | Variante. |
| `business_id` | text not null | Negocio. |
| `batch_id` | text nullable | Lote. |
| `page_id` | text not null | Pagina Meta. |
| `scheduled_at` | timestamptz not null | Fecha/hora. |
| `message` | text | Caption publicado. |
| `image_url` | text nullable | Imagen. |
| `publishable_asset_id` | text nullable | MediaAsset enviado/intencionado para Meta. |
| `facebook_post_id` | text nullable | ID Meta. |
| `status` | text not null | ScheduledPostStatus. |
| `remote_status` | text not null default `no_enviado` | Estado de sincronizacion con Meta. |
| `retry_count` | integer default 0 | Intentos. |
| `created_at` | timestamptz | Alta. |
| `updated_at` | timestamptz | Cambio. |

### `jobs`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | text primary key | ID. |
| `type` | text not null | JobType. |
| `status` | text not null | JobStatus. |
| `workspace_id` | text not null | Workspace. |
| `business_id` | text nullable | Negocio. |
| `batch_id` | text nullable | Lote. |
| `photo_id` | text nullable | Foto. |
| `variant_id` | text nullable | Variante. |
| `scheduled_post_id` | text nullable | Post. |
| `dedupe_key` | text not null | Anti-duplicados. |
| `payload` | jsonb default `{}` | Entrada sanitizada. |
| `result` | jsonb default `{}` | Salida sanitizada. |
| `request_id` | text nullable | Trazabilidad. |
| `idempotency_key` | text nullable | Clave idempotente. |
| `operation_key` | text nullable | Side effect externo. |
| `lease_expires_at` | timestamptz nullable | Vencimiento lease. |
| `next_retry_at` | timestamptz nullable | Proximo reintento. |
| `last_attempt_id` | text nullable | Ultimo intento. |
| `attempts` | integer default 0 | Intentos. |
| `max_attempts` | integer default 3 | Maximo. |
| `run_after` | timestamptz | Fecha de ejecucion. |
| `locked_at` | timestamptz nullable | Lock. |
| `locked_by` | text nullable | Worker. |
| `last_error` | text nullable | Error seguro. |
| `created_at` | timestamptz | Alta. |
| `updated_at` | timestamptz | Cambio. |

### `idempotency_records`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | text primary key | ID. |
| `workspace_id` | text not null | Workspace. |
| `actor_id` | text nullable | Actor. |
| `method` | text not null | Metodo HTTP. |
| `route_key` | text not null | Ruta normalizada. |
| `idempotency_key` | text not null | Header del cliente. |
| `request_hash` | text not null | Hash de entrada sanitizada. |
| `response` | jsonb nullable | Respuesta o referencia a job. |
| `status` | text not null | processing/succeeded/failed. |
| `created_at` | timestamptz | Alta. |
| `expires_at` | timestamptz | Retencion. |

### `outbox_events`

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | text primary key | ID. |
| `event_type` | text not null | Tipo de evento. |
| `aggregate_type` | text not null | Entidad principal. |
| `aggregate_id` | text not null | ID de entidad. |
| `workspace_id` | text nullable | Workspace. |
| `business_id` | text nullable | Negocio. |
| `payload` | jsonb default `{}` | Payload sanitizado. |
| `status` | text not null | pending/processing/processed/failed. |
| `available_at` | timestamptz | Fecha de proceso. |
| `processed_at` | timestamptz nullable | Fecha procesado. |
| `attempts` | integer default 0 | Intentos. |
| `last_error` | text nullable | Error seguro. |
| `created_at` | timestamptz | Alta. |

## SQL recomendado para base primaria

Este SQL muestra el minimo nuevo que debe existir si se parte de la migracion parcial anterior. Una reconstruccion limpia debe crear todas las tablas listadas arriba con FK/RLS completas.

```sql
create table if not exists public.workspaces (
  id text primary key,
  name text not null,
  owner_user_id text,
  plan text,
  billing_status text not null default 'trial',
  entitlements jsonb not null default '{}'::jsonb,
  status text not null default 'activo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id text not null,
  user_id text not null,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_id_idx
  on public.workspace_members (user_id);

create table if not exists public.billing_accounts (
  id text primary key,
  workspace_id text not null,
  provider text not null,
  provider_customer_id text,
  provider_subscription_id text,
  provider_subscription_item_id text,
  provider_price_id text,
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_accounts_workspace_id_idx on public.billing_accounts (workspace_id);

create table if not exists public.billing_provider_events (
  id text primary key,
  provider text not null,
  provider_event_id text not null,
  workspace_id text,
  type text not null,
  status text not null default 'received',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);

create unique index if not exists billing_provider_events_provider_event_idx
  on public.billing_provider_events (provider, provider_event_id);
create index if not exists billing_provider_events_workspace_idx
  on public.billing_provider_events (workspace_id);

create table if not exists public.audit_logs (
  id text primary key,
  workspace_id text not null,
  actor_id text,
  action text not null,
  entity_type text not null,
  entity_id text,
  request_id text,
  job_id text,
  before jsonb,
  after jsonb,
  ip_hash text,
  user_agent_hash text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_workspace_created_idx
  on public.audit_logs (workspace_id, created_at);
create index if not exists audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id);
create index if not exists audit_logs_request_id_idx
  on public.audit_logs (request_id);

create table if not exists public.privacy_requests (
  id text primary key,
  workspace_id text not null,
  actor_id text not null,
  type text not null,
  status text not null default 'requested',
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  export_url text,
  expires_at timestamptz,
  last_error text
);

create index if not exists privacy_requests_workspace_idx
  on public.privacy_requests (workspace_id, requested_at);

create table if not exists public.upload_intents (
  id text primary key,
  workspace_id text not null,
  business_id text not null,
  batch_id text not null,
  photo_id text,
  bucket text not null,
  storage_key text not null,
  allowed_mime_types jsonb not null default '[]'::jsonb,
  max_bytes integer not null,
  status text not null default 'created',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists upload_intents_storage_key_idx
  on public.upload_intents (bucket, storage_key);
create index if not exists upload_intents_workspace_idx
  on public.upload_intents (workspace_id, created_at);

create table if not exists public.media_assets (
  id text primary key,
  workspace_id text not null,
  business_id text,
  batch_id text,
  photo_id text,
  variant_id text,
  scheduled_post_id text,
  kind text not null,
  bucket text not null,
  storage_key text not null,
  public_url text,
  signed_url_expires_at timestamptz,
  mime_type text not null,
  bytes integer not null,
  width integer,
  height integer,
  content_hash text not null,
  status text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists media_assets_bucket_key_idx
  on public.media_assets (bucket, storage_key);
create index if not exists media_assets_workspace_kind_idx
  on public.media_assets (workspace_id, kind, status);
create index if not exists media_assets_photo_id_idx on public.media_assets (photo_id);
create index if not exists media_assets_variant_id_idx on public.media_assets (variant_id);

create table if not exists public.model_profiles (
  id text primary key,
  task text not null,
  provider text not null default 'openai',
  primary_model text not null,
  fallback_model text,
  reasoning_effort text,
  text_verbosity text,
  image_quality text,
  output_schema_version text,
  timeout_ms integer not null,
  max_estimated_cost_usd numeric(12,6),
  batch_allowed boolean not null default false,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists model_profiles_task_status_idx
  on public.model_profiles (task, status);

create table if not exists public.prompt_templates (
  id text primary key,
  task text not null,
  version text not null,
  status text not null default 'draft',
  stable_instructions text not null,
  variable_contract jsonb not null default '{}'::jsonb,
  output_schema_version text not null,
  owner_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists prompt_templates_task_version_idx
  on public.prompt_templates (task, version);
create index if not exists prompt_templates_task_status_idx
  on public.prompt_templates (task, status);

create table if not exists public.ai_runs (
  id text primary key,
  workspace_id text not null,
  business_id text,
  batch_id text,
  photo_id text,
  variant_id text,
  job_id text,
  operation_key text,
  provider text not null default 'openai',
  task text not null,
  model_profile_id text not null,
  prompt_template_id text,
  prompt_version text,
  schema_version text,
  input_hash text not null,
  output_hash text,
  response_id text,
  status text not null,
  usage jsonb not null default '{}'::jsonb,
  cached_tokens integer,
  estimated_cost_usd numeric(12,6),
  latency_ms integer,
  safety_flags jsonb not null default '[]'::jsonb,
  error_code text,
  request_id text,
  trace_id text,
  created_at timestamptz not null default now()
);

create index if not exists ai_runs_workspace_created_idx
  on public.ai_runs (workspace_id, created_at);
create index if not exists ai_runs_operation_key_idx
  on public.ai_runs (operation_key);
create index if not exists ai_runs_variant_id_idx
  on public.ai_runs (variant_id);

create table if not exists public.ai_quality_checks (
  id text primary key,
  workspace_id text not null,
  variant_id text not null,
  ai_run_id text,
  schema_version text not null default 'ai_quality_check.v1',
  status text not null,
  score numeric(4,3) not null,
  warnings jsonb not null default '[]'::jsonb,
  blocking_reasons jsonb not null default '[]'::jsonb,
  requires_human_review boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ai_quality_checks_variant_id_idx
  on public.ai_quality_checks (variant_id, created_at);

create table if not exists public.ai_evaluations (
  id text primary key,
  task text not null,
  dataset_id text not null,
  model_profile_id text not null,
  prompt_template_id text,
  prompt_version text,
  baseline_evaluation_id text,
  status text not null,
  metrics jsonb not null default '{}'::jsonb,
  report_url text,
  created_at timestamptz not null default now()
);

create index if not exists ai_evaluations_task_created_idx
  on public.ai_evaluations (task, created_at);

create table if not exists public.meta_authorizations (
  id text primary key,
  workspace_id text not null,
  actor_id text,
  meta_user_id text,
  status text not null,
  granted_scopes jsonb not null default '[]'::jsonb,
  declined_scopes jsonb not null default '[]'::jsonb,
  missing_required_scopes jsonb not null default '[]'::jsonb,
  granted_page_ids jsonb not null default '[]'::jsonb,
  app_mode text not null default 'unknown',
  app_review_status text not null default 'unknown',
  graph_api_version text not null,
  token_expires_at timestamptz,
  last_debug_at timestamptz,
  encrypted_access_token text,
  token_key_id text,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meta_authorizations_workspace_id_idx on public.meta_authorizations (workspace_id);
create index if not exists meta_authorizations_status_idx on public.meta_authorizations (status);

create table if not exists public.facebook_pages (
  id text primary key,
  workspace_id text not null,
  meta_authorization_id text,
  meta_page_id text not null,
  page_name text not null,
  page_access_token text,
  page_access_token_key_id text,
  last_token_use_at timestamptz,
  category text,
  category_list jsonb not null default '[]'::jsonb,
  tasks jsonb not null default '[]'::jsonb,
  is_granted boolean not null default true,
  cover_photo_url text,
  page_access_token_status text,
  granted_scopes jsonb not null default '[]'::jsonb,
  declined_scopes jsonb not null default '[]'::jsonb,
  token_expires_at timestamptz,
  last_debug_at timestamptz,
  graph_api_version text,
  is_selected boolean not null default false,
  updated_at timestamptz not null default now()
);

create unique index if not exists facebook_pages_workspace_meta_page_idx
  on public.facebook_pages (workspace_id, meta_page_id);

create table if not exists public.meta_publishing_capabilities (
  id text primary key,
  workspace_id text not null,
  facebook_page_id text not null,
  graph_api_version text not null,
  can_publish_photo boolean not null default false,
  can_remote_schedule_photo boolean not null default false,
  can_delete_remote_post boolean not null default false,
  can_read_scheduled_posts boolean not null default false,
  preferred_delivery_mode text not null default 'local_due_publish',
  last_probe_at timestamptz,
  last_probe_result text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists meta_publishing_capabilities_page_version_idx
  on public.meta_publishing_capabilities (workspace_id, facebook_page_id, graph_api_version);

create table if not exists public.scheduled_posts (
  id text primary key,
  workspace_id text not null,
  variant_id text not null,
  business_id text not null,
  batch_id text,
  page_id text not null,
  scheduled_at timestamptz not null,
  message text,
  image_url text,
  publishable_asset_id text,
  facebook_post_id text,
  remote_post_type text,
  remote_post_url text,
  delivery_mode text not null default 'local_due_publish',
  graph_api_version text,
  publish_lead_seconds integer,
  scheduled_at_unix bigint,
  status text not null,
  remote_status text not null default 'no_enviado',
  retry_count integer not null default 0,
  last_remote_sync_at timestamptz,
  remote_error_code text,
  remote_trace_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_posts_page_id_idx on public.scheduled_posts (page_id);
create index if not exists scheduled_posts_scheduled_at_idx on public.scheduled_posts (scheduled_at);
create index if not exists scheduled_posts_status_idx on public.scheduled_posts (status);
create index if not exists scheduled_posts_remote_status_idx on public.scheduled_posts (remote_status);

create unique index if not exists scheduled_posts_facebook_post_id_idx
  on public.scheduled_posts (workspace_id, facebook_post_id)
  where facebook_post_id is not null;

create table if not exists public.metric_definitions (
  id text primary key,
  provider text not null,
  canonical_metric text not null,
  provider_metric_name text,
  graph_api_version text,
  value_type text not null,
  status text not null default 'active',
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists metric_definitions_provider_name_version_idx
  on public.metric_definitions (provider, coalesce(provider_metric_name, canonical_metric), coalesce(graph_api_version, 'internal'), effective_from);
create index if not exists metric_definitions_canonical_status_idx
  on public.metric_definitions (canonical_metric, status);

create table if not exists public.post_metric_snapshots (
  id text primary key,
  workspace_id text not null,
  business_id text not null,
  scheduled_post_id text not null,
  facebook_post_id text,
  metric_definition_id text not null,
  provider text not null,
  canonical_metric text not null,
  provider_metric_name text,
  window text not null,
  value numeric(18,6) not null,
  collected_at timestamptz not null default now(),
  observed_until timestamptz not null,
  collection_status text not null default 'ok',
  source_version text,
  raw_ref text
);

create index if not exists post_metric_snapshots_post_window_idx
  on public.post_metric_snapshots (scheduled_post_id, window, collected_at);
create index if not exists post_metric_snapshots_business_metric_idx
  on public.post_metric_snapshots (business_id, canonical_metric, window, collected_at);

create table if not exists public.performance_summaries (
  id text primary key,
  workspace_id text not null,
  business_id text not null,
  scope text not null,
  scope_key text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  sample_size integer not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  confidence text not null default 'exploratoria',
  reason_codes jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now()
);

create unique index if not exists performance_summaries_scope_period_idx
  on public.performance_summaries (workspace_id, business_id, scope, scope_key, period_start, period_end);

-- En una reconstruccion limpia, agregar FK internas con ON DELETE RESTRICT para:
-- businesses.workspace_id -> workspaces.id
-- businesses.facebook_page_id -> facebook_pages.id
-- batches.workspace_id/business_id -> workspaces/businesses
-- photos.workspace_id/business_id/batch_id -> workspaces/businesses/batches
-- variants.workspace_id/business_id/batch_id/photo_id -> workspaces/businesses/batches/photos
-- scheduled_posts.workspace_id/business_id/variant_id -> workspaces/businesses/variants
-- jobs workspace/business/batch/photo/variant/scheduled_post segun columna no nula

-- Habilitar RLS en tablas expuestas y crear policies por workspace antes de permitir acceso directo desde cliente.
-- Si la app solo habla con API Fastify, mantener RLS como defensa en profundidad y restringir grants publicos.

create table if not exists public.pricing_rules (
  id text primary key,
  provider text not null,
  model text not null,
  operation text not null,
  unit_type text not null,
  unit_size double precision not null default 1,
  dimensions jsonb not null default '{}'::jsonb,
  currency text not null default 'USD',
  unit_cost_usd double precision not null,
  customer_unit_price_usd double precision not null,
  price_version text not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pricing_rules_lookup_idx
  on public.pricing_rules (provider, model, operation, active, effective_from);

create table if not exists public.usage_meters (
  id text primary key,
  workspace_id text not null,
  metric text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  limit_value double precision,
  reserved_value double precision not null default 0,
  used_value double precision not null default 0,
  updated_at timestamptz not null default now()
);

create unique index if not exists usage_meters_workspace_metric_period_idx
  on public.usage_meters (workspace_id, metric, period_start);

create table if not exists public.cost_ledger (
  id text primary key,
  workspace_id text not null,
  business_id text,
  batch_id text,
  job_id text,
  operation_key text,
  entry_type text not null default 'actual',
  status text not null default 'posted',
  usage_metric text,
  provider text not null,
  model text not null,
  operation text not null,
  quantity integer not null default 1,
  provider_cost_usd double precision not null,
  customer_price_usd double precision not null,
  price_version text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists cost_ledger_operation_entry_idx
  on public.cost_ledger (operation_key, entry_type)
  where operation_key is not null;

create table if not exists public.jobs (
  id text primary key,
  type text not null,
  status text not null,
  workspace_id text not null,
  business_id text,
  batch_id text,
  photo_id text,
  variant_id text,
  scheduled_post_id text,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  request_id text,
  idempotency_key text,
  operation_key text,
  lease_expires_at timestamptz,
  next_retry_at timestamptz,
  last_attempt_id text,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists jobs_active_dedupe_idx
  on public.jobs (type, dedupe_key)
  where status in ('queued', 'running', 'blocked', 'needs_user_action');

create index if not exists jobs_status_run_after_idx on public.jobs (status, run_after);
create index if not exists jobs_business_id_idx on public.jobs (business_id);
create index if not exists jobs_batch_id_idx on public.jobs (batch_id);
create index if not exists jobs_lease_expires_at_idx on public.jobs (lease_expires_at);
create unique index if not exists jobs_operation_key_idx
  on public.jobs (operation_key)
  where operation_key is not null and status in ('queued', 'running', 'blocked', 'needs_user_action');

create table if not exists public.job_attempts (
  id text primary key,
  job_id text not null,
  workspace_id text not null,
  attempt_number integer not null,
  status text not null,
  operation_key text,
  provider text,
  provider_request_id text,
  provider_resource_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  last_error text
);

create unique index if not exists job_attempts_job_attempt_idx
  on public.job_attempts (job_id, attempt_number);
create index if not exists job_attempts_operation_key_idx on public.job_attempts (operation_key);

create table if not exists public.external_operations (
  operation_key text primary key,
  workspace_id text not null,
  job_id text,
  provider text not null,
  operation text not null,
  status text not null,
  provider_request_id text,
  provider_resource_id text,
  idempotency_key_sent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists external_operations_workspace_idx on public.external_operations (workspace_id);
create index if not exists external_operations_status_idx on public.external_operations (status);

create table if not exists public.idempotency_records (
  id text primary key,
  workspace_id text not null,
  actor_id text,
  method text not null,
  route_key text not null,
  idempotency_key text not null,
  request_hash text not null,
  response jsonb,
  status text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create unique index if not exists idempotency_records_key_idx
  on public.idempotency_records (workspace_id, actor_id, method, route_key, idempotency_key);

create table if not exists public.outbox_events (
  id text primary key,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  workspace_id text,
  business_id text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists outbox_events_status_available_idx
  on public.outbox_events (status, available_at);
```

## Persistencia y respaldo

La fuente primaria es DB. El snapshot JSON solo puede usarse como respaldo secundario, export diagnostico o migracion.

Snapshot opcional:

```ts
type OptionalBackupState = {
  metaToken?: {
    token: string;
    status: FacebookTokenStatus;
    source: "auto" | "manual_support" | "refresh" | "oauth_callback" | "device_login";
    connectedAt: string;
  } | null;
  pages: MetaPage[];
  pendingDeviceLogin?: object | null;
  selectedPageId?: string | null;
  selectedBusinessId?: string | null;
  visualStyles: VisualStyle[];
  businesses: Business[];
  batches: Batch[];
  photos: Photo[];
  variants: Variant[];
  scheduledPosts: ScheduledPost[];
  jobs: Job[];
  events: LearningEvent[];
  autonomyByBusiness: Array<[string, AutonomyState]>;
};
```

Seguridad:

- Este archivo puede contener tokens si se exporta mal. Tratarlo como secreto.
- No subirlo a Git.
- No incluirlo en backups publicos.
- En produccion, preferir no depender de el para operar.

## Indices minimos

Para performance:

- `users.email`.
- `workspaces.owner_user_id`.
- `workspace_members.workspace_id`.
- `billing_provider_events.provider, provider_event_id` unico.
- `audit_logs.workspace_id, created_at`.
- `audit_logs.entity_type, entity_id`.
- `privacy_requests.workspace_id, requested_at`.
- `upload_intents.bucket, storage_key` unico.
- `media_assets.bucket, storage_key` unico.
- `media_assets.workspace_id, kind, status`.
- `facebook_pages.workspace_id, meta_page_id` unico.
- `businesses.facebook_page_id`.
- `businesses.workspace_id`.
- `businesses.workspace_id, facebook_page_id` unico para negocios activos.
- `batches.business_id`.
- `batches.workspace_id`.
- `photos.batch_id`.
- `variants.batch_id`.
- `variants.photo_id`.
- `scheduled_posts.page_id`.
- `scheduled_posts.scheduled_at`.
- `scheduled_posts.status`.
- `scheduled_posts.remote_status`.
- `jobs.status, jobs.run_after`.
- `jobs.type, jobs.dedupe_key`.
- `jobs.operation_key` unico para side effects activos.
- `job_attempts.job_id, attempt_number`.
- `external_operations.operation_key`.
- `usage_meters.workspace_id, metric, period_start` unico.
- `cost_ledger.operation_key, entry_type` unico cuando exista.
- `idempotency_records.workspace_id, actor_id, method, route_key, idempotency_key`.

## Validaciones obligatorias

### Al crear lote

- Debe existir negocio.
- Negocio debe tener pagina.
- Si hay lote activo, decidir si se reutiliza o se bloquea creacion.

### Al subir foto

- Lote trabajable.
- `fileSize` dentro de limite.
- `contentType` imagen soportada.
- ruta principal: upload directo binario a Storage con signed URL; `complete-upload` recibe `storageKey`.
- `imageDataUrl` solo fallback de desarrollo/emergencia y no se loguea.
- Crear job `analyze_photo`.

### Al generar

- Lote trabajable.
- Hay fotos validadas.
- Costo confirmado o decision de autonomia lo permite.
- `variantsPerPhoto` entre 1 y limite configurable.
- Proveedor de imagen usa lote pequeno.
- Crear jobs idempotentes `generate_batch` y `generate_variant`.
- Crear outbox events en la misma transaccion.

### Al aprobar

- Variante existe.
- Variante pertenece al lote.
- Variante esta `generada`.
- Lote trabajable.

### Al confirmar calendario

- Hay variantes aprobadas.
- Fechas futuras.
- Periodo permitido: 7, 14 o 30 dias.
- Negocio tiene zona horaria.
- Crear job `schedule_posts`.

### Al publicar

- Scheduled post existe.
- No esta cancelado/publicado.
- Pagina tiene page access token.
- Imagen tiene `publishableAssetId` y URL HTTPS accesible por Meta.
- Si falla el acceso Meta, marcar `pausada_por_token`.
- Ejecutar por job `publish_post` o `retry_post`.
- Bloquear si existe `facebookPostId`.

## Contratos de respuesta visibles

### Error

```ts
type AppErrorResponse = {
  ok: false;
  code: string;
  message: string;
  userMessage: string;
  requestId: string;
  details?: unknown | null;
};
```

Regla:

- `message` para diagnostico tecnico sanitizado.
- `userMessage` para app.
- `details` no debe incluir tokens, headers, body crudo ni query con token.

### Dashboard

```ts
type BusinessDashboard = {
  business: BusinessSummary;
  alerts: BusinessAlert[];
  activeBatch?: BatchSummary | null;
  batches: BatchSummary[];
  performance: BusinessPerformanceSummary | null;
  weeklyReport?: WeeklyReport | null;
};
```

### Job visible

```ts
type JobSummary = {
  id: string;
  type: JobType;
  status: JobStatus;
  progress?: number;
  userMessage?: string;
  createdAt: string;
  updatedAt: string;
};
```

### Alert

```ts
type BusinessAlert = {
  id: string;
  type: "facebook_token" | "post_failed" | "batch_abandoned" | "system";
  message: string;
  level: "info" | "warning" | "critical";
  createdAt: string;
  actionable: boolean;
  actionLabel?: string;
};
```

## Criterios de completitud de datos

Un rebuild esta completo si:

- Puede conectar Meta sin exponer tokens.
- Puede listar paginas sin page access token.
- Puede crear negocio por pagina.
- Puede editar SEO por negocio.
- Puede crear lote.
- Puede subir foto.
- Puede analizar foto.
- Puede generar variantes cuadradas.
- Cada variante tiene estilo propio.
- Puede editar caption.
- Puede aprobar/rechazar.
- Puede cancelar lote y bloquearlo.
- Puede programar calendario.
- Puede publicar por worker; la accion manual solo crea/adelanta job `publish_post`.
- Puede ejecutar vision, generacion, scheduling y publicacion por jobs.
- Puede marcar acceso Meta expirado.
- Puede reintentar despues de reconexion.
- Puede persistir estado primario en DB fuera de la PC local.
- Puede reconstruir estado tras reinicio del servidor.

