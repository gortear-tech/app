# Pilot readiness

Before using FBmaniaco with real users, run:

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm smoke
pnpm verify:pilot
```

After a Render deploy, run the live smoke check against the public API:

```bash
API_BASE_URL=https://your-api.onrender.com EXPECTED_APP_ENV=staging pnpm smoke:deploy
```

For Supabase/Postgres, apply and verify migrations before the live smoke:

```bash
DATABASE_URL=postgres://... pnpm db:migrate
DATABASE_URL=postgres://... pnpm db:migrate:check
```

The readiness check intentionally fails if deployed environments can silently use the local JSON datastore. Staging/production must use `DATA_STORE_MODE=supabase` and `ALLOW_LOCAL_DATASTORE=false`.

Current status:

- Local/mock mode is ready for product flow testing.
- Render config is guarded against local datastore usage.
- Mobile staging/production builds require public HTTPS API URLs.
- Supabase/Postgres datastore wiring exists for identity, workspaces, jobs, Meta page selection, businesses, batches, upload intents, uploaded photos, derived media assets, cost estimation/confirmation, variant generation/review, scheduling, mock publish flow, metrics, weekly reports, evals/autonomy, billing status/events, idempotency, outbox, and worker heartbeat.
- Remaining real-pilot work is to replace mock providers with approved production credentials and validate the deployed Supabase project with real secrets, migrations, and webhook endpoints.
