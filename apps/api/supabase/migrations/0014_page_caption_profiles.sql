insert into public.model_profiles
  (id, task, provider, primary_model, reasoning_effort, text_verbosity, schema_version, timeout_ms, status)
values
  ('caption-default-v1', 'caption', 'openai', 'gpt-4o', null, 'low', 'caption.v1', 30000, 'active')
on conflict (id) do update
set task = excluded.task,
    provider = excluded.provider,
    primary_model = excluded.primary_model,
    text_verbosity = excluded.text_verbosity,
    schema_version = excluded.schema_version,
    timeout_ms = excluded.timeout_ms,
    status = excluded.status,
    updated_at = now();

insert into public.prompt_templates
  (id, task, prompt_version, stable_instructions, schema_version, status)
values
  (
    'page-caption-generation',
    'caption',
    'caption-page-context-v1',
    'Genera captions para una sola pagina de Facebook usando nombre de pagina, categoria, estilo y analisis observable de la imagen. No mezcles contexto de otras paginas ni inventes precios, promociones, disponibilidad o claims comerciales.',
    'caption.v1',
    'active'
  )
on conflict (id) do update
set task = excluded.task,
    prompt_version = excluded.prompt_version,
    stable_instructions = excluded.stable_instructions,
    schema_version = excluded.schema_version,
    status = excluded.status,
    updated_at = now();
