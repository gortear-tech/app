# Cadencia

Cadencia es una app Expo/React Native para crear, revisar y programar publicaciones de Facebook por pagina, con backend TypeScript y Supabase como fuente de verdad.

Este repo arranca la app por etapas y ya incluye la primera conexion local con Meta:

- `mobile/`: app Expo con navegacion inicial, tema Material 3 y flujo UI de publicacion.
- `backend/`: API Node/TypeScript con endpoints demo, health check y rutas `/api` para leer paginas, fotos y calendario desde Meta Graph API.
- `shared/`: tipos, catalogo de estilos, prompt fijo, asignacion de estilos y programacion.
- `supabase/`: migracion SQL inicial con tablas, checks, indices y RLS.

Los secretos viven en `.env` locales ignorados por git. El cliente movil solo conoce `EXPO_PUBLIC_API_BASE_URL`; los tokens de Meta, Supabase y OpenAI se quedan en el backend.

## Requisitos

- Node.js 20.19 o superior.
- npm con workspaces.

## Arranque local

```bash
npm install
npm run typecheck
npm run backend
npm run mobile
```

La app movil inicia sesion con Facebook mediante OAuth. El backend intercambia el codigo por un token de larga duracion y sincroniza las paginas con sus Page access tokens, que se guardan solo del lado servidor.

Para Facebook Login for Business, configura `META_LOGIN_CONFIG_ID`; en ese modo Meta usa `config_id` en lugar de `scope`. Si no existe esa configuracion, el backend usa el flujo OAuth clasico con los permisos minimos para listar paginas y preparar publicaciones.

## Siguiente etapa

Para empujar el esquema a Supabase hace falta:

- `SUPABASE_ACCESS_TOKEN`
- referencia/ID del proyecto Supabase

Los demas secretos se piden mas adelante, justo antes de necesitarlos.
