# Modulo transversal - Decisiones tecnologicas por trabajo concreto
### Juicio profesional del stack de FBmaniaco

Fecha de revision: 2026-05-08

## Veredicto ejecutivo

El diseno actual es correcto en su direccion principal: app movil Expo, API Fastify, Postgres/Supabase como fuente de verdad, Storage para media, jobs/worker para IA y Meta, y OpenAI/Meta como proveedores externos. No conviene cambiar a una arquitectura mas pesada ni a microservicios.

Lo que si debe afinarse profesionalmente:

1. Usar Supabase Auth para identidad de FBmaniaco, separado de Meta.
2. Usar TanStack Query en la app para estado remoto, cache, invalidacion y refetch.
3. Usar Supabase Queues/PGMQ como cola preferida y `jobs` como ledger de negocio.
4. Usar Supabase Cron solo para tareas recurrentes del sistema, no para cada post individual.
5. Mantener Render, pero produccion necesita API y worker reales; el plan free no debe considerarse suficiente para operacion diaria.
6. Mantener Fastify, pero con JSON Schema/TypeBox y OpenAPI desde el principio.
7. Mantener Supabase Storage para el MVP; considerar Cloudflare R2/CDN solo si egress/costo crecen.
8. Usar Sentry desde la primera version util, porque los errores reales ocurriran en movil, workers, Meta y OpenAI.
9. Usar OpenAI Responses API con Structured Outputs para analisis/captions; usar Images API con modelo configurable y fallback.
10. Usar Batch/Flex de OpenAI solo para trabajos no urgentes, como reportes, evaluaciones o regeneraciones masivas sin espera inmediata.
11. Reemplazar el token manual de Facebook como experiencia principal por autorizacion oficial Meta: Facebook Login/OAuth, Login for Business si aplica, o device login solo si esta soportado. Los tokens tecnicos siguen existiendo, pero solo backend/worker los reciben y guardan.
12. Agregar pricing server-side y ledger de costos desde el MVP para no depender de una constante fija por variante.
13. Separar modelo comercial de cobro: plan/entitlements en DB desde el inicio; Stripe o Mercado Pago se agregan como providers, no como logica central.

## Fuentes profesionales revisadas

- Supabase Queues: Postgres-native queue con entrega garantizada y visibility window. Fuente: https://supabase.com/docs/guides/queues
- Supabase Cron: jobs recurrentes en Postgres, recomendado no mas de 8 jobs concurrentes y maximo 10 minutos por job. Fuente: https://supabase.com/docs/guides/cron
- Render Background Workers: separa tareas largas de la ruta critica y cita IA/modelos como caso comun. Fuente: https://render.com/docs/background-workers
- Expo EAS Build: servicio hospedado para binarios Expo/React Native. Fuente: https://docs.expo.dev/build/introduction/
- Expo SecureStore: almacenamiento local cifrado de pares llave/valor. Fuente: https://docs.expo.dev/versions/latest/sdk/securestore/
- Supabase Auth: autenticacion/autorizacion, JWT y RLS integrados con Postgres. Fuente: https://supabase.com/docs/guides/auth
- Supabase Storage: CDN global, control fino de acceso e image optimization. Fuente: https://supabase.com/docs/guides/storage
- TanStack Query: invalidacion inteligente y refetch de queries cuando un dato queda obsoleto por accion del usuario. Fuente: https://tanstack.com/query/v3/docs/framework/react/guides/query-invalidation
- Fastify validation: Ajv v8 para validacion y fast-json-stringify para respuestas. Fuente: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- Expo/Sentry: crash reporting con contexto de dispositivo, version, ruta y usuario. Fuente: https://docs.expo.dev/guides/using-sentry/
- OpenAI GPT-5.5/Responses: Responses API, Structured Outputs, prompt caching y reasoning controls ayudan confiabilidad, latencia y costo. Fuente: https://developers.openai.com/api/docs/guides/latest-model#using-reasoning-models
- OpenAI Batch API: 50% de descuento, mayor headroom de rate limits y finalizacion dentro de 24 horas para trabajos no inmediatos. Fuente: https://developers.openai.com/api/docs/guides/batch#overview
- OpenAI Image Models: guia de abril 2026 recomienda `gpt-image-2` como default nuevo; `gpt-image-1.5` queda como fallback/migracion. Fuente: https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide#model-summary
- Fastify TypeScript: Fastify documenta uso directo con TypeScript y schemas de rutas. Fuente: https://fastify.dev/docs/latest/Reference/TypeScript/
- Expo TypeScript: Expo tiene soporte de primera clase para TypeScript. Fuente: https://docs.expo.dev/guides/typescript/
- Sharp/libvips: procesamiento de imagen de alto rendimiento en Node.js, 4x-5x mas rapido que ImageMagick/GraphicsMagick en resize tipico. Fuente: https://sharp.pixelplumbing.com/
- PostgreSQL PL/pgSQL: triggers y funciones para auditoria, summaries y automatismos cercanos a los datos. Fuente: https://www.postgresql.org/docs/current/plpgsql-trigger.html
- Maestro React Native: pruebas E2E moviles sobre binario final, compatible con Expo/EAS y sin modificar codigo JS/TS. Fuente: https://docs.maestro.dev/get-started/supported-platform/react-native
- Playwright TypeScript: pruebas web/admin/API en TypeScript con soporte de `tsconfig`. Fuente: https://playwright.dev/docs/test-typescript
- Vitest: soporte ESM, TypeScript y JSX out-of-box. Fuente: https://vitest.dev/
- Stripe Billing: subscriptions, usage-based billing, invoices, entitlements y webhooks para provisionar/revocar acceso de forma asincrona. Fuentes: https://docs.stripe.com/billing/subscriptions/webhooks y https://docs.stripe.com/billing/subscriptions/usage-based/how-it-works
- Mercado Pago: alternativa local de pagos/suscripciones para LatAm; debe integrarse como provider intercambiable si el mercado lo exige. Fuente operativa: https://status.mercadopago.com/
- RevenueCat: infraestructura para compras y suscripciones in-app; util si el cobro se hace por App Store/Google Play, no como primera opcion para APK B2B con cobro web. Fuente: https://www.revenuecat.com/docs/

## Matriz de decisiones

| Trabajo concreto | Tecnologia recomendada | Veredicto | Por que |
| --- | --- | --- | --- |
| App Android celular primero | Expo / React Native + EAS Build | Mantener | Es la ruta mas eficiente para APK/AAB sin equipo nativo grande. |
| Sesion del usuario FBmaniaco | Supabase Auth | Agregar | Meta no debe ser la identidad interna. FBmaniaco necesita `userId`, `workspaceId`, auditoria y permisos propios. |
| Tokens/sesion local movil | Expo SecureStore | Agregar | Guardar solo tokens de sesion o flags sensibles pequenos. No guardar page access tokens de Meta en el celular. |
| Permisos internos | `workspace_members` + validacion backend + RLS | Agregar | Los roles deben vivir en DB/API, no en botones ocultos de la app. |
| Secretos persistidos Meta | Cifrado app/server-only con `keyId` y rotacion | Agregar | Page tokens permiten publicar; deben tratarse como secretos de alto impacto. |
| Estado remoto en pantallas | TanStack Query | Agregar | Evita cache manual fragil y permite invalidar queries tras comandos como aprobar, cancelar, programar o reconectar. |
| API publica | Fastify | Mantener | Ligero, rapido, con validacion/serializacion por schema. No se justifica NestJS para el MVP. |
| Contratos API | JSON Schema + TypeBox + OpenAPI | Agregar | Alinea Fastify, TypeScript, validacion, docs y app movil sin duplicar contratos a mano. |
| Fuente de verdad | Supabase Postgres | Mantener | El producto es relacional: usuarios, paginas, negocios, lotes, fotos, variantes, posts, jobs y eventos. |
| Integridad de datos | Foreign keys, unique indexes, partial indexes, RLS y DTOs sanitizados | Agregar desde el inicio | Evita datos huerfanos, duplicados, filtraciones multi-tenant y estados imposibles. |
| Cola de trabajos | Supabase Queues/PGMQ + `jobs` ledger | Mantener como preferido | Menos infraestructura que Redis/BullMQ, vive junto a Postgres y soporta visibility timeout. |
| Idempotencia operativa | `Idempotency-Key` + `dedupeKey` + `operationKey` + `ExternalOperation` | Agregar desde el inicio | Evita duplicar comandos, jobs y side effects externos aunque el worker caiga o el usuario reintente. |
| Tareas recurrentes | Supabase Cron | Agregar con limite | Ideal para barridos, limpieza, reportes y encolar trabajos periodicos. No usarlo como scheduler de cada post. |
| Worker | Render Background Worker | Mantener, pero no en free | IA, media, reportes y APIs externas deben salir de requests HTTP. Produccion necesita worker continuo. |
| Ambientes y release | Render web/worker separados por ambiente + staging real + tags/releases | Agregar desde el inicio | Evita probar con datos/tokens productivos y permite validar migraciones, App Review, Meta/OpenAI y rollback antes de usuarios reales. |
| Recuperacion operativa | Supabase backups/PITR + plan separado para Storage + runbooks probados | Agregar antes de cobrar | Restaurar Postgres no restaura objetos de Storage; sin dry-run se descubre el fallo cuando ya hay incidente. |
| Media | Supabase Storage con buckets privado/publicable | Mantener | CDN global y signed URLs cubren el MVP, pero originales y rechazados deben quedar privados. |
| Cadena de media | `upload_intents` + `media_assets` | Agregar | Evita perder trazabilidad entre original, thumbnail, vision input, generado y asset publicable para Meta. |
| Generacion/vision/captions | OpenAI Responses + Images API + `ModelProfile`/`PromptTemplate` | Mantener y afinar | Responses con Structured Outputs para datos confiables; Images API configurable para calidad/costo; perfiles versionados permiten fallback, rollout y rollback sin tocar la logica. |
| Calidad y evaluaciones IA | `AiRun` + `AiQualityCheck` + Evals API/golden set | Agregar desde el inicio | Sin evals y quality gates, un cambio de prompt/modelo puede romper captions, claims comerciales o costos sin alerta temprana. |
| Lotes no urgentes IA | OpenAI Batch/Flex | Agregar opcional | Para ahorro cuando el usuario no espera resultado inmediato. No usar en aprobacion interactiva. |
| Publicacion Facebook | Meta Graph API | Mantener | Es el proveedor oficial necesario para publicar en paginas. Encapsularlo en provider y tolerar fallas/app review. |
| Programacion de posts | Scheduler propio en DB/worker + `remote_schedule` opcional | Afinar | El MVP no debe depender de que Meta scheduling funcione igual para todas las paginas/versiones; la DB mantiene verdad local y Meta se usa con capabilities probadas. |
| Autorizacion Facebook | Facebook Login/OAuth, Login for Business si aplica; device login solo si esta soportado | Cambiar experiencia principal | El usuario no debe pegar tokens. Meta entrega credenciales tecnicas al backend despues de autorizar, y el backend valida scopes/paginas granulares. |
| Observabilidad | Sentry + logs estructurados + trazas OpenTelemetry-compatible + metricas de jobs | Agregar | Sin esto, errores de movil, workers, Meta y OpenAI se vuelven invisibles; Sentry resuelve producto/equipo pequeno y OTel evita encierro futuro. |
| Metricas de performance | Snapshots propios + Meta Insights como proveedor variable | Afinar | Meta cambia/depreca metricas; el producto debe aprender con eventos propios y degradar Insights sin romper reportes. |
| Costos de IA | Pricing rules + usage meters + cost ledger en DB | Agregar | Permite estimar, reservar, confirmar y auditar costo real por proveedor/modelo sin hardcodear precios ni gastar antes de validar presupuesto. |
| Planes y limites comerciales | Entitlements + usage meters server-side en Postgres | Agregar | El MVP necesita limitar negocios, fotos, variantes, publicaciones y presupuesto IA aunque el cobro real llegue despues. |
| Cobro B2B web | Stripe Billing como provider preferido | Agregar cuando se cobre | Mejor opcion general para suscripciones, uso medido, invoices y webhooks. No debe bloquear el piloto. |
| Cobro local Mexico/LatAm | Mercado Pago como provider alterno | Agregar solo si el mercado lo exige | Buen complemento local; no debe reemplazar el modelo interno de plan/entitlements. |
| Cobro in-app movil | RevenueCat / tiendas moviles | Evitar en MVP | No encaja si el producto se distribuye como APK B2B y el cobro se hace fuera de App Store/Play Store. |
| Tiempo real de progreso | Polling corto + Realtime opcional | Mantener asi | Polling es mas simple y robusto. Realtime agrega valor solo para progreso fino. |

## Matriz de lenguajes por funcion

Veredicto general: TypeScript debe ser el idioma principal del producto. Reduce cambio de contexto, permite compartir contratos entre movil/API/worker y evita crear servicios extra sin necesidad. SQL/PLpgSQL debe usarse solo donde la logica pertenece a Postgres. Python, Go o Rust no aportan suficiente valor en el MVP salvo necesidades futuras muy concretas.

| Funcion | Lenguaje recomendado | Alternativa futura | Decision |
| --- | --- | --- | --- |
| App movil Expo/React Native | TypeScript/TSX | Kotlin/Swift solo para modulos nativos inevitables | Mantener TypeScript. Es el camino natural de Expo y permite compartir tipos. |
| Componentes visuales y navegacion | TypeScript/TSX | Ninguna para MVP | Mantener. Evita duplicar UI nativa. |
| Cache y estado remoto movil | TypeScript con TanStack Query | Ninguna | Mantener. Query keys e invalidaciones viven mejor junto a pantallas. |
| API HTTP Fastify | TypeScript en Node.js | Go solo si la API se vuelve CPU-bound o de latencia extrema | Mantener TypeScript. Fastify ya encaja con schemas y tipos. |
| Worker de jobs | TypeScript en Node.js | Go/Rust solo si hay procesamiento CPU-bound masivo | Mantener TypeScript. Los jobs son I/O-bound: OpenAI, Meta, Storage, DB. |
| Providers OpenAI/Meta/Supabase | TypeScript | HTTP crudo si SDK falla | Mantener. La SDK oficial de OpenAI soporta JS/TS y Meta Graph es HTTP. |
| Contratos compartidos | TypeScript + JSON Schema/TypeBox | Protobuf solo si aparecen multiples clientes/plataformas | Mantener. El producto actual necesita claridad mas que binarios compactos. |
| Migraciones y consultas | SQL | ORM completo solo si aporta trazabilidad clara | Mantener SQL explicito para schema, indices, constraints y views. |
| Triggers, auditoria y summaries cercanos a datos | PL/pgSQL muy acotado | Worker si la regla toca proveedores externos | Agregar solo para automatismos locales a DB. No meter logica de negocio compleja en triggers. |
| Cola PGMQ | SQL/PGMQ + consumidor TypeScript | Redis/BullMQ si crece throughput/workflows | Mantener. Mensaje minimo `jobId`; ejecucion real en worker TS. |
| Procesamiento simple de imagen | TypeScript + Sharp/libvips en worker | Servicio Go/Rust/Python si se vuelve pipeline pesado | Agregar Sharp solo para resize, conversion, metadata, thumbnails y compresion. IA de imagen sigue en OpenAI. |
| IA, prompts, captions y ranking | TypeScript orquestando OpenAI | Python solo para ML propio, entrenamiento o evaluaciones cientificas | Mantener TypeScript. No hay modelo propio que justifique Python. |
| Reportes y analitica operativa | SQL views/summaries + TypeScript | Python notebooks solo para exploracion offline | Mantener SQL/TS. Python queda fuera del runtime productivo; summaries deben recalcularse desde eventos y snapshots. |
| Pruebas unitarias backend/domain | TypeScript con Vitest | Jest si el repo ya lo adopta | Preferir Vitest por velocidad y compatibilidad TS moderna. |
| Pruebas E2E movil | YAML Maestro + builds Expo/EAS | Detox si se necesitan asserts nativos profundos | Agregar Maestro. Menos friccion para flujos reales de celular. |
| Pruebas web/admin/API | TypeScript con Playwright/API tests | k6 para carga especializada | Agregar Playwright si aparece panel web/admin o smoke tests HTTP. |
| Scripts de mantenimiento | TypeScript ejecutado con pnpm | PowerShell solo para tareas locales Windows | Mantener TypeScript para scripts portables del repo. |
| Infra/deploy | YAML (`render.yaml`, EAS config) + SQL migrations | Terraform solo al crecer ambientes/equipos | Mantener configuracion simple por ahora. |

## Lenguajes que conviene evitar por ahora

### Python en produccion principal

Python seria excelente para notebooks, analisis exploratorio o modelos propios, pero ahora las tareas de IA son llamadas a OpenAI. Meter Python crearia otro runtime, otro deploy y otro sistema de contratos sin beneficio proporcional.

### Go/Rust para API o worker

Go o Rust son buenas opciones para CPU, networking muy exigente o binarios pequenos. FBmaniaco hoy es mayormente I/O-bound: DB, Storage, Meta y OpenAI. TypeScript da mas velocidad de producto y mejor reuse con la app.

### Kotlin/Swift para toda la app

Serian mas adecuados si el producto necesitara capacidades nativas profundas, alto rendimiento grafico o integracion especifica de Android/iOS. Para un MVP Android primero con UI de negocio, Expo/TypeScript es mas eficiente.

### SQL/PLpgSQL para reglas de negocio complejas

SQL debe proteger datos, constraints, views, auditoria y summaries. Las reglas que llaman Meta/OpenAI, calculan autonomia o deciden UX deben vivir en API/worker para ser testeables y observables.

## Decisiones que no recomiendo

### No cambiar Fastify por NestJS todavia

NestJS puede servir en equipos grandes, pero aqui agregaria ceremonia antes de validar producto. Fastify ya resuelve API rapida, validacion por schema y buena separacion por plugins.

### No meter Redis/BullMQ como primera opcion

BullMQ es excelente, pero obliga a operar Redis/Valkey adicional. Como el producto ya usa Supabase/Postgres, PGMQ simplifica mucho. Redis/BullMQ queda como plan B si aparecen necesidades de alto throughput, workflows complejos o dashboards avanzados de cola.

### No prometer exactly-once end-to-end

PGMQ entrega mensajes dentro de una ventana de visibilidad, pero Meta/OpenAI/Storage siguen siendo sistemas externos. La garantia profesional es "al menos una vez con idempotencia, dedupe y reconciliacion", no exactly-once real. Por eso se agregan `JobAttempt` y `ExternalOperation`.

### No usar Supabase Edge Functions para IA larga

Pueden servir para webhooks o tareas cortas cerca de la DB, pero no son el lugar principal para generacion de imagen, reintentos Meta, reportes y procesos largos. Eso debe vivir en worker.

### No depender de Meta como login interno

Meta es permiso operativo para paginas. FBmaniaco necesita identidad propia para historial, auditoria, recuperacion, multi-negocio y soporte. La UX puede ocultar la complejidad con login anonimo, magic link o social login, pero el modelo de datos debe tener usuario real.

### No asumir que todas las paginas aparecen o quedan autorizadas

Meta aplica permisos granulares por pagina y puede devolver menos paginas que las que el usuario espera. El sistema debe registrar `grantedPageIds`, `declinedScopes`, `missingRequiredScopes` y estado de App Review. La seleccion de pagina debe validar permisos reales, no solo existencia de un ID.

### No vender autopublicacion como promesa base

La publicacion automatica depende de permisos Meta, App Review, historial de confianza, controles de pausa, presupuesto y observabilidad. El producto base debe ser valioso aunque `FACEBOOK_PUBLISH` requiera confirmacion humana. Esto reduce riesgo comercial, soporte y duplicados.

### Observabilidad recomendada

Sentry debe entrar desde la primera version util porque cubre errores movil/API/worker, source maps, contexto de release y trazas sin montar una plataforma pesada. Los logs y spans deben seguir nombres/campos compatibles con OpenTelemetry para que, si crece el producto, se pueda enviar la misma telemetria a otro backend. OWASP guia la regla de seguridad: registrar lo necesario para investigar, sanitizar entradas y nunca guardar secretos o payloads crudos.

### No acoplar el negocio a un proveedor de pagos

Stripe o Mercado Pago deben ser providers intercambiables. El producto debe decidir acceso por `workspace.plan`, `billingStatus` y `entitlements`, no por respuestas directas del SDK de pagos en la app movil.

### Separar cobro de consumo interno

Stripe Billing/Entitlements ayuda a cobrar y sincronizar features, pero el producto no debe depender de Stripe para saber si puede gastar IA en este instante. La decision operativa vive en Postgres: `entitlements`, `usage_meters`, reservas y `cost_ledger`. Luego se puede reportar uso agregado a Stripe o Mercado Pago para factura, pero no al reves.

### No usar cron por cada publicacion

La publicacion debe ser un `scheduled_post` y un job reclamado por worker. Cron sirve para despertar el sistema, encolar pendientes, limpiar bloqueos, generar reportes y revisar salud.

## Arquitectura recomendada final

```text
App Expo
  -> TanStack Query + SecureStore
  -> API Fastify HTTPS
     -> Supabase Auth valida usuario/sesion
     -> Supabase Postgres fuente primaria
     -> Supabase Storage privados/publicables
     -> Outbox transaccional
     -> Supabase Queues/PGMQ mensajes ejecutables
  -> Worker Render continuo
     -> Reclama PGMQ/jobs
     -> OpenAI Responses/Images
     -> Meta Graph API
     -> Sentry/tracing/logs/metricas
  -> Supabase Cron
     -> Limpieza, reportes, reenqueue, health checks
```

## Reglas de implementacion futuras

1. Cada tecnologia debe tener una responsabilidad clara.
2. Si una herramienta duplica una responsabilidad ya cubierta, no se agrega.
3. Si una tarea cruza red externa, IA, media pesada o reintento, debe ir a job/worker.
4. Si una pantalla depende de datos de servidor, debe usar query keys e invalidaciones, no variables globales manuales.
5. Si una decision de IA produce estado de negocio, debe persistirse con schema y no quedarse como texto libre.
6. Si una integracion externa falla, debe dejar rastro en `jobs`, `events`, logs y Sentry.
7. Si un proveedor cambia de modelo/API, se cambia por variable de entorno y fallback, no por edicion profunda del producto.
8. Si una funcion consume IA, publica en Meta o supera limites del plan, debe validar entitlements en backend antes de crear jobs.
9. Si un job llama a proveedor externo, debe crear `JobAttempt` y `ExternalOperation` antes de la llamada.
10. Si cambia un prompt/modelo/schema, debe existir `PromptTemplate`/`ModelProfile` nuevo, eval contra golden set y rollout canary antes de activar.

## Fuente de verdad

Este documento justifica decisiones tecnologicas. La aplicacion concreta de esas decisiones vive en los documentos fuente definidos por `00_indice.md`. No debe usarse como checklist paralelo de implementacion.
