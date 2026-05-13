# Auditoria de completitud de documentos FBmaniaco

Fecha de auditoria: 2026-05-08
Carpeta auditada: `C:\Users\Gabriel\Desktop\FBmaniaco - documentos de diseÃ±o`
Repositorio revisado: `C:\Users\Gabriel\Desktop\FB maniaco`

## Resultado

Estado: completo para reconstruccion funcional v1.

Despues de revisar los documentos contra el codigo actual y elevar el diseno a una arquitectura profesional, se completaron seis huecos:

- Inventario de APIs y seguridad: resuelto en `10_seguridad.md`.
- Contratos duros de tipos, estados y tablas: resuelto en `11_datos.md`.
- Navegacion, UX movil y QA: resuelto en `12_ux_qa.md`.
- Comunicacion transversal entre modulos: resuelto en `14_comunicacion.md`.
- DB primaria, usuarios/workspaces y jobs: resuelto en `08_api.md` y `11_datos.md`.
- Integracion de inteligencia como servicios internos: resuelto en `07_ia.md`.
- Eliminacion del token manual como experiencia principal de produccion: resuelto en `02_meta.md`, `10_seguridad.md` y `15_decisiones_tecnologicas.md`.
- Sincronizacion remota obligatoria con Meta para editar/cancelar publicaciones ya confirmadas: resuelto en `05_calendario.md` y `11_datos.md`.
- Costos auditables por proveedor/modelo en vez de formula fija: resuelto en `04_lotes.md`, `08_api.md` y `11_datos.md`.

## Lo que ya queda cubierto

| Area | Documento principal | Estado |
| --- | --- | --- |
| Vision general del producto | `01_base.md` | Cubierto |
| Conexion Meta y paginas | `02_meta.md` | Cubierto |
| Home/dashboard | `03_home.md` | Cubierto |
| Lotes, fotos, variantes y aprobacion | `04_lotes.md` | Cubierto |
| Calendario y publicacion | `05_calendario.md` | Cubierto |
| Configuracion, estilos y SEO | `06_configuracion.md` | Cubierto |
| Inteligencia IA integrada y jobs | `07_ia.md` | Cubierto |
| API, comandos, lecturas, jobs y persistencia | `08_api.md` | Cubierto |
| Operacion y despliegue | `09_despliegue.md` | Cubierto |
| APIs externas e internas | `10_seguridad.md` | Cubierto |
| Contratos, estados y tablas | `11_datos.md` | Cubierto |
| UX, navegacion y pruebas | `12_ux_qa.md` | Cubierto |
| Comunicacion modular | `14_comunicacion.md` | Cubierto |

## Comparacion contra codigo actual

### Monorepo

Cubierto:

- `apps/api`: API Fastify, comandos, lecturas, jobs, config y persistencia DB.
- `apps/mobile`: Expo/React Native, navegacion, API client.
- `apps/worker`: jobs de IA, programacion, publicacion, reintentos y metricas.
- `packages/shared`: contratos y estados.
- `packages/providers`: Meta, OpenAI, Supabase.
- servicios internos de IA: decision, memoria, prompts, autonomia, estilos y ranking.
- `supabase/migrations`: esquema base.
- `render.yaml`: despliegue.
- `apps/mobile/app.config.ts`: build movil y API publica.

### Endpoints

Cubiertos:

- Salud.
- Bootstrap.
- Token Meta.
- Paginas Meta.
- Estilos.
- Negocios.
- Dashboard.
- Lotes.
- Fotos.
- Costos.
- Variantes.
- Calendario.
- Scheduled posts.
- Publicacion manual/retry/cancelacion.

### Estados

Cubiertos:

- User.
- Facebook token.
- Batch.
- Photo.
- Variant.
- Scheduled post.
- AI task.
- Action type.
- Risk/confidence.
- Learning event.
- Visual style intensity.
- Disclosure policy.

### Pantallas

Cubiertas:

- Boot.
- Token.
- Reconnect.
- Pages.
- Welcome.
- Home.
- Batch.
- Calendar.
- Settings.
- Styles.
- Report.

## Hallazgos importantes

### Hallazgo 1 - Esquema Supabase debe ser fuente primaria

La version inicial trataba Supabase como espejo o respaldo parcial. El diseno profesional requiere DB primaria con:

- `users`.
- `workspaces`.
- `facebook_pages`.
- `businesses`.
- `batches`.
- `photos`.
- `variants`.
- `scheduled_posts`.
- `jobs`.
- `events`.
- `metric_definitions`.
- `post_metric_snapshots`.
- `performance_summaries`.

Accion tomada:

- Se documento el esquema recomendado completo en `11_datos.md`.

### Hallazgo 2 - Tokens y backups

Tokens de Meta y page access tokens no deben depender de runtime local ni snapshots como fuente primaria.

Accion tomada:

- Se definio DB primaria con secretos server-only/cifrados.
- Se marco todo backup/export como secreto.
- Se reforzo matriz de exposicion en `10_seguridad.md`.

### Hallazgo 3 - Tareas lentas deben ser jobs

La generacion de IA y publicacion en Meta no deben vivir como requests largos.

Accion tomada:

- Se agrego tabla `jobs`, worker obligatorio y reglas de dedupe/idempotencia en `07_ia.md`, `08_api.md`, `11_datos.md` y `14_comunicacion.md`.
- Se agrego opcion preferida de Supabase Queues/PGMQ como cola fisica para simplificar workers sin perder ledger `jobs`.
- Se agrego outbox transaccional para evitar inconsistencia entre estado, jobs y eventos.

### Hallazgo 4 - Rebuild necesita QA explicito

Los modulos describian flujo, pero no habia una matriz de pruebas que garantizara que la app funciona sin PC y sin recortes visuales.

Accion tomada:

- Se agrego `12_ux_qa.md`.

## Limites intencionales de esta auditoria

- No se modifico TapalpaDamus.
- No se copiaron secretos.
- No se abrio contenido sensible del estado local para documentar datos reales.
- No se cambio codigo de la app.
- No se ejecutaron deploys ni builds.

## Checklist final de reconstruccion

Un equipo externo o una IA generadora podria reconstruir FBmaniaco si sigue estos documentos y cumple:

- Backend Fastify con rutas descritas.
- App movil Expo con pantallas descritas.
- Worker de jobs IA/publicacion.
- OpenAI para vision, imagen y caption.
- Meta Graph para paginas y publicaciones.
- Autorizacion Meta oficial sin pedir tokens manuales al usuario final.
- Supabase/Postgres para DB primaria y Storage para media/backups.
- Render para API publica.
- Expo/EAS para APK.
- SEO por pagina integrado en captions.
- Estilo por variante.
- Imagen cuadrada 1:1.
- Approval con imagen completa.
- Lotes cancelados bloqueados.
- Costos estimados/confirmados por pricing server-side.
- Editar/cancelar posts sincroniza Meta o queda como estado incierto visible.
- Secretos fuera de la app movil.

## Estado final

La carpeta de documentos queda como especificacion funcional, tecnica, operacional y de seguridad para recrear FBmaniaco v1 desde cero.

