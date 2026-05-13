# Backlog tecnico de implementacion FBmaniaco v1

Fecha de corte: 2026-05-11

## Proposito

Este documento convierte la especificacion auditada en un plan de construccion ejecutable. El objetivo no es listar ideas, sino ordenar el trabajo para que cada fase deje una base verificable para la siguiente.

Regla principal:

- Primero se construye la plataforma confiable: identidad, datos, contratos, seguridad, jobs y observabilidad.
- Despues se construye el flujo de valor: conectar pagina, subir fotos, generar variantes, aprobar, programar y publicar.
- Al final se agregan autonomia, aprendizaje, reportes avanzados y cobro real.

## Criterio de prioridad

| Prioridad | Significado |
| --- | --- |
| P0 | Bloquea cualquier version usable. Sin esto no se debe construir encima. |
| P1 | Necesario para MVP funcional con usuarios reales controlados. |
| P2 | Necesario antes de produccion comercial o cobro. |
| P3 | Mejora posterior; no debe distraer al MVP. |

## Fase 0 - Preparacion del monorepo y contratos base

Prioridad: P0

Finalidad:

Crear una base tecnica que impida duplicar tipos, estados y reglas entre app, API y worker.

Dependencias:

- Ninguna.

Entregables:

- Monorepo con `apps/mobile`, `apps/api`, `apps/worker`, `packages/shared`, `packages/providers`.
- TypeScript configurado de forma consistente.
- `packages/shared` con estados, enums, schemas TypeBox/JSON Schema y errores normalizados.
- OpenAPI generado desde schemas de API.
- Scripts basicos: typecheck, lint, test, format, dev.
- Config por ambiente: development, staging, production.

Historias tecnicas:

| ID | Historia | Prioridad | Criterio de aceptacion |
| --- | --- | --- | --- |
| F0-01 | Crear estructura de monorepo | P0 | Cada app/package compila sin depender de rutas absolutas locales. |
| F0-02 | Definir estados compartidos | P0 | Batch, Photo, Variant, ScheduledPost, Job y errores viven en `packages/shared`. |
| F0-03 | Configurar schemas y OpenAPI | P0 | La API valida entrada/salida con los mismos contratos usados por cliente. |
| F0-04 | Configurar ambientes | P0 | Staging y production tienen variables separadas; mobile production no acepta localhost. |
| F0-05 | Crear convencion de errores | P0 | Los errores tienen `code`, `message`, `userMessage`, `retryable`, `action`. |

No empezar la fase 1 hasta que:

- El repo compila completo.
- Existe un contrato compartido minimo.
- Hay una forma clara de cargar config sin secretos en el cliente movil.

## Fase 1 - Datos, identidad interna y seguridad multi-tenant

Prioridad: P0

Finalidad:

Crear la fuente de verdad real del producto. Meta no es la identidad interna; FBmaniaco necesita usuarios, workspaces, roles y permisos propios.

Dependencias:

- Fase 0.

Entregables:

- Supabase Auth integrado.
- Migraciones Postgres iniciales.
- RLS y validacion backend por workspace.
- Tablas base: users, workspaces, workspace_members, pages, businesses.
- Audit logs basicos.
- Gestion de secretos server-only.

Historias tecnicas:

| ID | Historia | Prioridad | Criterio de aceptacion |
| --- | --- | --- | --- |
| F1-01 | Integrar Supabase Auth | P0 | Un usuario puede iniciar sesion y la API identifica `userId`. |
| F1-02 | Crear workspaces y miembros | P0 | Toda lectura/escritura queda scopeada por `workspaceId`. |
| F1-03 | Implementar roles internos | P0 | Viewer/editor/admin se valida server-side, no solo en UI. |
| F1-04 | Crear RLS base | P0 | Una sesion no puede leer datos de otro workspace por REST/DB. |
| F1-05 | Crear audit logs minimos | P1 | Login, cambios de pagina, publicacion y acciones costosas quedan auditados. |
| F1-06 | Implementar secretos server-only | P0 | Ningun token de proveedor aparece en app movil, respuestas JSON o logs normales. |

No empezar la fase 2 hasta que:

- La API bloquea correctamente acceso cross-workspace.
- Existen migraciones reproducibles.
- La app movil puede autenticarse contra API sin secretos de backend.

## Fase 2 - API, jobs ledger, cola e idempotencia

Prioridad: P0

Finalidad:

Hacer que las acciones lentas y externas sean seguras, reintentables y auditables antes de integrar OpenAI o Meta.

Dependencias:

- Fase 1.

Entregables:

- Fastify API con rutas de health, bootstrap y recursos base.
- Tablas `jobs`, `job_attempts`, `external_operations`, `idempotency_records`, `outbox_events`, `events`.
- Supabase Queues/PGMQ o adaptador local compatible.
- Worker con loop controlado.
- Idempotencia para comandos.
- Reconciliacion de side effects.

Historias tecnicas:

| ID | Historia | Prioridad | Criterio de aceptacion |
| --- | --- | --- | --- |
| F2-01 | Crear health/readiness | P0 | `/health` no filtra secretos; `/ready` falla si DB/queue/config critica falta. |
| F2-02 | Crear tabla `jobs` | P0 | Un job tiene tipo, estado, dedupeKey, runAfter, intentos y entidad destino. |
| F2-03 | Crear worker basico | P0 | El worker toma jobs vencidos, registra intento y actualiza estado final. |
| F2-04 | Crear idempotencia HTTP | P0 | Repetir una mutacion con misma key no duplica trabajo; body distinto devuelve conflicto. |
| F2-05 | Crear `external_operations` | P0 | Side effects externos tienen `operationKey`, proveedor, estado y trace sanitizado. |
| F2-06 | Crear outbox transaccional | P1 | Eventos de dominio nacen junto al cambio de estado, no como efecto perdido. |
| F2-07 | Crear reenqueue seguro | P1 | Jobs `running` vencidos vuelven a cola solo si no iniciaron proveedor externo. |

No empezar la fase 3 hasta que:

- Un comando idempotente crea un job una sola vez.
- El worker puede caer y recuperarse sin duplicar jobs.
- Los estados ambiguos tienen ruta de reconciliacion.

## Fase 3 - Conexion Meta oficial y seleccion de pagina

Prioridad: P0

Finalidad:

Reemplazar el token manual como experiencia principal y conectar paginas de forma profesional.

Dependencias:

- Fases 1 y 2.

Entregables:

- Flujo Meta OAuth/Facebook Login/Login for Business segun configuracion aprobada.
- Modo token manual solo desarrollo/soporte controlado.
- Cifrado de tokens persistidos con `keyId`.
- Probe de permisos y capacidades por pagina.
- Pantallas: boot, conectar Meta, reconectar, selector de paginas, bienvenida.

Historias tecnicas:

| ID | Historia | Prioridad | Criterio de aceptacion |
| --- | --- | --- | --- |
| F3-01 | Iniciar autorizacion Meta | P0 | Usuario no pega tokens en flujo normal; backend recibe credenciales por flujo oficial. |
| F3-02 | Guardar credenciales cifradas | P0 | Tokens viven server-side cifrados y con metadata de expiracion/ultimo uso. |
| F3-03 | Listar paginas disponibles | P0 | Solo paginas con permisos suficientes aparecen seleccionables. |
| F3-04 | Detectar permisos incompletos | P0 | UI explica reconexion sin mostrar detalles tecnicos sensibles. |
| F3-05 | Crear capability probe | P1 | Por pagina se guarda si puede publicar, leer insights, programar remoto y cancelar remoto. |
| F3-06 | Crear reconexion Meta | P0 | Token expirado pausa acciones y permite reconectar sin perder datos locales. |

No empezar la fase 4 hasta que:

- Existe una pagina conectada por workspace.
- Los permisos reales de Meta estan representados como capacidades.
- El backend puede bloquear publicacion si falta permiso.

## Fase 4 - Media, uploads y negocios

Prioridad: P0

Finalidad:

Permitir subir fotos de forma segura, trazable y preparada para IA/Meta.

Dependencias:

- Fases 1 a 3.

Entregables:

- Tablas `upload_intents`, `media_assets`, `businesses`, `batches`, `photos`.
- Buckets privados/publicables.
- Signed URLs con TTL corto.
- Verificacion MIME/contenido/tamano.
- Thumbnails y versiones para vision.
- Pantallas Home y crear lote basicas.

Historias tecnicas:

| ID | Historia | Prioridad | Criterio de aceptacion |
| --- | --- | --- | --- |
| F4-01 | Crear negocio por pagina | P0 | Un workspace puede configurar negocio ligado a pagina Meta. |
| F4-02 | Crear batch | P0 | Batch nace en estado trabajable y aparece en Home. |
| F4-03 | Crear upload intent | P0 | La app sube directo a Storage sin mandar base64 por API. |
| F4-04 | Completar upload | P0 | API valida objeto, crea `Photo` y `MediaAsset original`. |
| F4-05 | Generar derivados | P1 | Thumbnail/vision input se crean y quedan privados. |
| F4-06 | Bloquear archivos peligrosos | P0 | MIME falso, tamano excesivo o intent vencido no crean foto ni job. |

No empezar la fase 5 hasta que:

- Una foto subida tiene trazabilidad completa en DB y Storage.
- Originales quedan privados.
- La app puede mostrar lote activo y fotos sin depender de archivos locales.

## Fase 5 - IA basica, prompts versionados y variantes

Prioridad: P1

Finalidad:

Crear el primer flujo de valor: analizar fotos, generar variantes y captions con calidad controlada.

Dependencias:

- Fase 4.

Entregables:

- Providers OpenAI encapsulados.
- ModelProfile y PromptTemplate versionados.
- AiRun, AiQualityCheck y salida estructurada.
- Jobs `analyze_photo`, `generate_batch`, `generate_variant`.
- Quality gates minimos.
- Pantalla de progreso y aprobacion de variantes.

Historias tecnicas:

| ID | Historia | Prioridad | Criterio de aceptacion |
| --- | --- | --- | --- |
| F5-01 | Crear provider OpenAI | P1 | Modelos, timeouts, fallback y errores se configuran server-side. |
| F5-02 | Analizar foto | P1 | Job guarda analisis estructurado o error normalizado sin prompt completo en logs. |
| F5-03 | Generar variante | P1 | Cada variante referencia foto, estilo, aiRun, promptVersion y media generada. |
| F5-04 | Generar caption | P1 | Caption respeta negocio/SEO y no inventa claims sensibles. |
| F5-05 | Aplicar quality gate | P1 | Variante insegura queda bloqueada o con warning antes de aprobar/publicar. |
| F5-06 | Aprobar/rechazar variante | P1 | Estado cambia de forma idempotente y la UI invalida queries correctas. |

No empezar la fase 6 hasta que:

- Un usuario puede subir foto, generar al menos una variante y aprobarla.
- Cambiar modelo/prompt no exige tocar logica de negocio.
- Los costos estimados no se basan en constantes hardcodeadas.

## Fase 6 - Costos, limites, planes y presupuesto

Prioridad: P1

Finalidad:

Evitar que la IA y proveedores externos generen gasto no controlado o imposible de auditar.

Dependencias:

- Fases 2 y 5.

Entregables:

- Pricing rules.
- Usage meters.
- Cost ledger.
- Entitlements por workspace.
- Reserva y confirmacion de costo.
- Bloqueos server-side por plan/presupuesto.

Historias tecnicas:

| ID | Historia | Prioridad | Criterio de aceptacion |
| --- | --- | --- | --- |
| F6-01 | Crear pricing rules | P1 | Cada modelo/proveedor tiene precio versionado y vigente por fecha. |
| F6-02 | Crear usage meters | P1 | Fotos, variantes, publicaciones y presupuesto se miden por workspace/periodo. |
| F6-03 | Reservar presupuesto | P1 | Antes de llamar proveedor se reserva cupo; si no alcanza, no se crea job costoso. |
| F6-04 | Confirmar costo real | P1 | `cost_ledger` registra estimado/real por job, modelo y operationKey. |
| F6-05 | Liberar reserva | P1 | Cancelar o fallar antes de proveedor libera presupuesto reservado. |
| F6-06 | Bloquear por plan | P1 | Superar entitlement bloquea en API aunque la UI muestre boton. |

No empezar la fase 7 hasta que:

- Un reintento no duplica costo.
- Los costos son auditables por workspace, job y proveedor.
- La app explica bloqueo por limite sin exponer precios internos sensibles.

## Fase 7 - Calendario, scheduler propio y publicacion Meta

Prioridad: P1

Finalidad:

Convertir variantes aprobadas en publicaciones reales, sin duplicados ni estados falsos.

Dependencias:

- Fases 3, 4, 5 y 6.

Entregables:

- Tabla `scheduled_posts`.
- Scheduler propio por DB/worker.
- `local_due_publish` como modo base.
- `remote_schedule` opcional segun capability.
- Jobs `schedule_posts`, `publish_post`, `retry_post`, `sync_remote_post`, `cancel_remote_post`, `reconcile_external_operation`.
- Estados `remoteStatus`, `deliveryMode`, `estado_incierto`.
- Pantalla calendario.

Historias tecnicas:

| ID | Historia | Prioridad | Criterio de aceptacion |
| --- | --- | --- | --- |
| F7-01 | Crear calendario local | P1 | Variantes aprobadas se programan en DB con hora y estado claro. |
| F7-02 | Publicar cuando vence | P1 | Worker publica solo posts debidos, con token valido y media publicable. |
| F7-03 | Guardar evidencia Meta | P1 | No se marca publicado sin `facebookPostId` o evidencia auditada. |
| F7-04 | Manejar timeout Meta | P1 | Post queda `estado_incierto`; retry exige reconciliacion. |
| F7-05 | Editar fecha local | P1 | Si no se envio a Meta, solo ajusta DB/job local. |
| F7-06 | Editar/cancelar remoto | P1 | Si existe `facebookPostId`, sincroniza Meta o queda incierto; nunca solo DB. |
| F7-07 | Publicar ahora | P1 | Accion manual usa misma idempotencia y protecciones que publish programado. |
| F7-08 | Reconexion por token | P1 | Token expirado pausa publicacion y muestra accion clara. |

No empezar la fase 8 hasta que:

- Un post se puede programar y publicar realmente en una pagina autorizada.
- Un fallo ambiguo no genera duplicados.
- Cancelar/editar respeta Meta cuando ya existe objeto remoto.

## Fase 8 - UX completa, engagement etico y QA movil

Prioridad: P1

Finalidad:

Hacer que el producto sea util, claro y repetible para el usuario, sin esconder estados tecnicos importantes.

Dependencias:

- Fases 3 a 7.

Entregables:

- Navegacion completa.
- Home con lote activo, alertas, mini calendario y progreso semanal.
- Settings de negocio, SEO, estilos y autonomia.
- Copy funcional de errores.
- TanStack Query con invalidaciones.
- Maestro E2E para flujos criticos.
- Pruebas unitarias/API base.

Historias tecnicas:

| ID | Historia | Prioridad | Criterio de aceptacion |
| --- | --- | --- | --- |
| F8-01 | Construir Home final | P1 | Usuario ve proxima accion, semana cubierta, alertas y lote activo. |
| F8-02 | Construir aprobacion visual | P1 | Imagen completa, caption editable, aprobar/rechazar sin doble tap. |
| F8-03 | Construir calendario final | P1 | Estados local/remoto/fallido/incierto son visibles y accionables. |
| F8-04 | Construir settings | P1 | Negocio, SEO, estilos y autonomia guardan cambios via API. |
| F8-05 | Implementar invalidaciones | P1 | Aprobar, cancelar, publicar y reconectar refrescan solo queries necesarias. |
| F8-06 | Crear suite QA movil | P1 | Flujos login, Meta, lote, IA mock, calendario y publish mock pasan en build. |
| F8-07 | Validar accesibilidad basica | P2 | Botones, textos, loading y errores son legibles en pantallas pequenas. |

No empezar la fase 9 hasta que:

- El flujo completo se puede completar en celular.
- Los errores principales tienen copy claro.
- QA cubre los casos de `12_ux_qa.md` para MVP.

## Fase 9 - Observabilidad, despliegue, staging y recuperacion

Prioridad: P1/P2

Finalidad:

Preparar el producto para usuarios reales controlados sin operar a ciegas.

Dependencias:

- Fases 0 a 8.

Entregables:

- Render API y worker por ambiente.
- Supabase staging y production separados.
- Sentry movil/API/worker.
- Logs estructurados con correlation ID.
- Worker heartbeat.
- Feature flags y kill switches.
- Backups y restore dry-run.
- EAS Build/Update con canales.

Historias tecnicas:

| ID | Historia | Prioridad | Criterio de aceptacion |
| --- | --- | --- | --- |
| F9-01 | Crear staging real | P1 | Staging no comparte DB, buckets, tokens ni webhooks con production. |
| F9-02 | Configurar Render API/worker | P1 | API y worker corren como servicios separados con health/readiness. |
| F9-03 | Configurar Sentry | P1 | Errores tienen ambiente, release, user/workspace anonimo y source maps. |
| F9-04 | Crear heartbeat worker | P1 | Si el worker se detiene, hay alerta y se pausan acciones riesgosas. |
| F9-05 | Implementar kill switches | P1 | Meta, OpenAI, remote schedule y autonomia se pueden apagar server-side. |
| F9-06 | Configurar EAS channels | P1 | Staging y production usan canales distintos y runtimeVersion correcto. |
| F9-07 | Probar rollback OTA | P2 | Update incorrecto puede volver a embedded compatible o update correctivo. |
| F9-08 | Probar restore dry-run | P2 | DB restaurada en entorno aislado verifica migraciones, RLS y media references. |

No pasar a piloto real hasta que:

- Staging ejecuta el flujo completo.
- Existe rollback documentado y probado al menos una vez.
- Un incidente de Meta/OpenAI puede apagarse sin apagar toda la app.

## Fase 10 - Metricas, aprendizaje y reportes

Prioridad: P2

Finalidad:

Convertir actividad real en aprendizaje util sin depender totalmente de metricas variables de Meta.

Dependencias:

- Fases 7 a 9.

Entregables:

- Metric definitions.
- Post metric snapshots.
- Performance summaries.
- Reporte semanal.
- Confidence levels.
- Degradacion si Meta Insights falla.

Historias tecnicas:

| ID | Historia | Prioridad | Criterio de aceptacion |
| --- | --- | --- | --- |
| F10-01 | Crear catalogo de metricas | P2 | Metricas propias y Meta viven versionadas y con estado available/deprecated. |
| F10-02 | Recolectar snapshots | P2 | Posts publicados guardan ventanas comparables sin mezclar 24h y lifetime. |
| F10-03 | Crear summaries | P2 | Performance se reconstruye desde eventos/snapshots y no desde cache opaca. |
| F10-04 | Crear reporte semanal | P2 | Reporte incluye cobertura, fallas, costos, aprendizajes y proxima accion. |
| F10-05 | Manejar sample pequeno | P2 | Menos de 20 posts usa confidence exploratoria y no afirma causalidad. |
| F10-06 | Degradar Insights | P2 | Si Meta no permite metricas, reporte usa datos propios y explica confianza baja. |

No pasar a cobro comercial hasta que:

- El usuario puede entender valor semanal del producto.
- Los reportes no inventan conclusiones estadisticas.
- Fallos de Meta Insights no rompen dashboard.

## Fase 11 - Autonomia controlada y evaluaciones IA

Prioridad: P2

Finalidad:

Permitir mas automatizacion solo cuando exista historial, limites, evaluaciones y opt-in claro.

Dependencias:

- Fases 5, 6, 7, 10.

Entregables:

- Autonomia por negocio.
- Eval/golden set para prompts.
- Canary de PromptTemplate/ModelProfile.
- Batch/Flex para evaluaciones no urgentes.
- Bloqueo automatico ante riesgo.

Historias tecnicas:

| ID | Historia | Prioridad | Criterio de aceptacion |
| --- | --- | --- | --- |
| F11-01 | Crear configuracion de autonomia | P2 | Usuario puede mantener humano aprueba, sugerir calendario o autopublicacion opt-in. |
| F11-02 | Crear reglas de bloqueo | P2 | Token vencido, costo excedido, persona visible, precio/promocion visible o estado incierto apagan autonomia. |
| F11-03 | Crear eval de prompts | P2 | Prompt canary peor que baseline no pasa a active. |
| F11-04 | Crear batch eval | P2 | Evaluaciones no interactivas usan Batch/Flex cuando conviene. |
| F11-05 | Crear rollout por perfil | P2 | ModelProfile/PromptTemplate pasan draft -> canary -> active -> retired. |

No activar autopublicacion real hasta que:

- Existe opt-in explicito.
- Hay historial suficiente.
- Quality gates y costos estan operando.
- Un kill switch puede apagar autonomia inmediatamente.

## Fase 12 - Cobro y administracion comercial

Prioridad: P2/P3

Finalidad:

Cobrar sin contaminar la logica central del producto con un proveedor de pagos.

Dependencias:

- Fases 6, 9 y 10.

Entregables:

- Planes y entitlements completos.
- Provider billing intercambiable.
- Stripe Billing preferido para B2B web.
- Mercado Pago opcional para LatAm si el mercado lo exige.
- Webhooks idempotentes.
- Pantallas de limite/upgrade.

Historias tecnicas:

| ID | Historia | Prioridad | Criterio de aceptacion |
| --- | --- | --- | --- |
| F12-01 | Definir planes comerciales | P2 | Planes viven como entitlements internos, no como strings del proveedor. |
| F12-02 | Crear billing provider interface | P2 | Stripe/Mercado Pago pueden integrarse sin cambiar reglas de producto. |
| F12-03 | Procesar webhooks | P2 | Evento duplicado no cambia dos veces el estado ni entitlements. |
| F12-04 | Crear bloqueo por pago | P2 | Workspace vencido mantiene lectura y bloquea acciones costosas/publicacion. |
| F12-05 | Crear upgrade flow | P3 | Usuario entiende limite y siguiente paso sin perder trabajo. |

## Orden recomendado de construccion

1. Fase 0: monorepo y contratos.
2. Fase 1: datos, identidad y seguridad.
3. Fase 2: jobs, cola e idempotencia.
4. Fase 3: Meta oficial y paginas.
5. Fase 4: media/uploads/negocios.
6. Fase 5: IA y variantes.
7. Fase 6: costos y limites.
8. Fase 7: calendario/publicacion.
9. Fase 8: UX completa y QA.
10. Fase 9: staging/observabilidad/recuperacion.
11. Fase 10: metricas/reportes.
12. Fase 11: autonomia/evals.
13. Fase 12: cobro.

## MVP controlado

Un MVP usable para piloto privado debe incluir:

- Fases 0 a 8 completas.
- De fase 9: staging, Sentry, kill switches, worker heartbeat y deploy API/worker.
- De fase 10: reporte simple puede ser manual o minimo.
- Fases 11 y 12 pueden quedar apagadas.

Debe permitir:

1. Crear cuenta.
2. Conectar pagina.
3. Crear negocio.
4. Subir fotos.
5. Generar variantes.
6. Aprobar captions/imagenes.
7. Programar calendario.
8. Publicar en Facebook.
9. Ver errores claros y reconectar si Meta falla.
10. Ver costo/limite basico antes de generar.

No debe prometer:

- Autopublicacion plena sin supervision.
- Reportes estadisticamente fuertes con pocos posts.
- Edicion/cancelacion remota garantizada si Meta no da capacidad.
- Multi-red social.
- Cobro automatizado si el piloto se cobra manualmente.

## Definition of Done global

Una fase se considera terminada solo si cumple:

- Migraciones aplicadas y reversibilidad/compatibilidad evaluada.
- Contratos compartidos actualizados.
- API valida input/output.
- App movil maneja loading, empty, error y success.
- Jobs son idempotentes cuando hay side effects.
- Logs no contienen secretos ni payloads sensibles.
- QA cubre casos felices y fallos principales.
- Documentos fuente se actualizan si cambia una decision.

## Riesgos principales del proyecto

| Riesgo | Mitigacion |
| --- | --- |
| Meta cambia permisos o limita paginas externas | Capability probe, estados claros y modo local_due_publish por defecto. |
| IA genera contenido incorrecto o costoso | Quality gates, ModelProfile, PromptTemplate, costos server-side y evals. |
| Worker duplica publicaciones tras caida | Jobs ledger, ExternalOperation, operationKey y reconciliacion. |
| Produccion usa secretos de staging o dev | Separacion estricta de ambientes y checklist de deploy. |
| Restore recupera DB pero no imagenes | Plan Storage separado y restore dry-run. |
| App movil oculta estados complejos | Copy funcional y estados visibles: pausada, fallida, incierta, no enviada, confirmada Meta. |
| Producto cobra antes de medir valor | Entitlements internos primero, cobro provider despues del piloto. |

## Trabajo que debe evitarse al inicio

- Microservicios separados para IA, Meta o billing.
- Kubernetes.
- Terraform completo antes de tener staging estable.
- Cobro in-app con tiendas moviles.
- Autopublicacion por defecto.
- Scheduler de un cron por post.
- Guardar tokens Meta en el celular.
- Usar Storage publico para originales.
- Prompts sin version ni evaluacion.
- Reportes que prometen causalidad con sample pequeno.

## Primer sprint recomendado

Objetivo:

Dejar lista la base para implementar sin deuda estructural.

Alcance:

- F0-01 a F0-05.
- F1-01 a F1-04.
- F2-01 a F2-03.

Resultado esperado:

- Monorepo compila.
- API responde health/readiness.
- Supabase Auth identifica usuario.
- Workspaces existen.
- DB impide cross-tenant.
- Worker procesa un job mock.
- App movil puede iniciar, llamar bootstrap y mostrar estado autenticado/no autenticado.

Segundo sprint recomendado:

- Completar idempotencia, external operations y outbox.
- Iniciar Meta oficial.
- Crear pages/businesses.
- Preparar pantalla de conexion y selector.

