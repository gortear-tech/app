# Operacion inicial

## Ambientes

- `development`: puede usar auth local, DB local y providers mock.
- `staging`: debe usar Supabase, Meta, OpenAI y buckets separados de production.
- `production`: debe usar secretos, DB, storage, app Meta y keys OpenAI propios.

Nunca compartir entre staging y production:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE`
- `DATABASE_URL`
- buckets de media
- `META_APP_ID` / `META_APP_SECRET`
- `OPENAI_API_KEY`
- webhooks de billing o Meta

## Render

`render.yaml` define dos servicios separados:

- `fbmaniaco-api`: web service con `/health` y `/ready`.
- `fbmaniaco-worker`: background worker continuo.

Comprobaciones despues del deploy:

```text
GET /health -> 200
GET /ready  -> 200 solo si DB, cola/config y heartbeat de worker estan listos
```

Comprobacion automatizada:

```bash
API_BASE_URL=https://tu-api-staging.onrender.com EXPECTED_APP_ENV=staging pnpm smoke:deploy
```

La comprobacion falla si la URL no es HTTPS, si `/health` no identifica la API esperada, o si `/ready` no confirma `config`, `db`, `queue` y `worker`.

En staging/production, `REQUIRE_WORKER_HEARTBEAT=true` debe permanecer activo.

## Migraciones DB

Aplicar migraciones antes de abrir trafico nuevo:

```bash
DATABASE_URL=postgres://... pnpm db:migrate
```

Comprobar que staging ya no tiene migraciones pendientes:

```bash
DATABASE_URL=postgres://... pnpm db:migrate:check
```

El runner registra cada archivo en `public.fbmaniaco_schema_migrations` con checksum. Si un SQL ya aplicado cambia, la comprobacion falla y debe resolverse con una nueva migracion, no editando historico aplicado.

## Kill switches

Usar estos flags para degradar de forma segura:

- `FEATURE_META_PUBLISHING=false`: pausa confirmar calendario/publicaciones.
- `FEATURE_OPENAI_VISION=false`: worker deja de analizar fotos.
- `FEATURE_OPENAI_IMAGE_GENERATION=false`: API bloquea generar variantes y worker no ejecuta jobs de variantes.
- `FEATURE_REMOTE_SCHEDULE=false`: mantiene modo `local_due_publish`.
- `FEATURE_AUTONOMY=false`: evita automatizacion sin aprobacion humana.

## Rollback

1. Apagar `FEATURE_META_PUBLISHING` y `FEATURE_OPENAI_IMAGE_GENERATION`.
2. Pausar worker si hay riesgo de duplicar publicaciones.
3. Revertir deploy de API/worker al release anterior en Render.
4. Verificar `/ready`.
5. Revisar `scheduled_posts` con `estado_incierto` antes de reactivar publish.

## Restore dry-run

1. Restaurar backup de Postgres en un proyecto Supabase aislado.
2. Ejecutar migraciones.
3. Verificar RLS de `workspaces`, `businesses`, `media_assets`, `variants`, `scheduled_posts`, `jobs`.
4. Revisar referencias de `media_assets` contra buckets.
5. Mantener workers apagados hasta reconciliar `external_operations` y publicaciones pendientes.
