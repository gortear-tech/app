# Seguridad y secretos

Cadencia no guarda secretos sensibles en el cliente movil.

## Donde vive cada secreto

- `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`, `SUPABASE_SERVICE_ROLE`, `DATABASE_URL` y `OPENAI_API_KEY`: solo backend.
- `META_APP_ID`: puede usarse en mobile y backend.
- Los tokens de usuario y de pagina de Meta se obtienen por OAuth y se guardan solo en Supabase/backend.
- `EXPO_TOKEN`, `RENDER_API_KEY`, `SUPABASE_ACCESS_TOKEN`: desarrollo/CI.
- Keystore Android: fuera del repo, preferentemente gestionado por EAS.

## Rotacion

1. Rotar el secreto en el proveedor correspondiente.
2. Actualizar el `.env` local o la variable en Render/GitHub Actions/EAS.
3. Redeployar el backend cuando el secreto afecte runtime.
4. Verificar `/health` y el flujo que dependa del secreto.

Los logs nunca deben imprimir valores completos de secretos.
