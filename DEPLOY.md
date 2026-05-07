# Despliegue sin depender de la PC

La app movil no debe hablar con `localhost` ni con la IP de esta computadora. La ruta estable es:

1. API de FBmaniaco en Render.
2. Respaldo del estado completo en Supabase Storage.
3. APK de Expo/EAS apuntando a la URL publica de Render.

## 1. Subir la API a Render

1. Sube este repo a GitHub.
2. En Render crea un **Blueprint** desde el repo.
3. Render detectara `render.yaml` y creara el servicio `fbmaniaco-api`.
   - El plan queda en `free` para no bloquearse por falta de metodo de pago.
   - El estado se respalda en Supabase Storage para no depender del disco local de Render.
4. Agrega los valores secretos que Render marque como pendientes:
   - `OPENAI_API_KEY`
   - `META_APP_ID`
   - `META_APP_SECRET`
   - `META_BOOTSTRAP_TOKEN` si quieres autoconexion inicial
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE`
   - `SUPABASE_STATE_BUCKET` si quieres cambiar el bucket por defecto
   - `SUPABASE_STATE_OBJECT` si quieres cambiar el archivo por defecto
   - `SUPABASE_MEDIA_BUCKET` si quieres cambiar el bucket de imagenes por defecto
5. Espera el deploy y abre:
   `https://TU-SERVICIO.onrender.com/health`

Debe responder:

```json
{"ok":true}
```

El estado runtime queda respaldado en Supabase Storage:

```text
bucket: fbmaniaco-runtime
object: runtime-state.json
```

Las imagenes nuevas se guardan en el bucket publico `fbmaniaco-media`, para que OpenAI y Facebook puedan leerlas desde una URL estable. Eso evita perder paginas, negocios, SEO y lotes cuando Render reinicia el servicio. Si mas adelante quieres publicaciones automaticas 24/7 sin que Render duerma el servicio, sube el plan de Render a uno de pago.

## 2. Compilar el APK apuntando a Render

Cuando tengas la URL publica, por ejemplo:

```text
https://fbmaniaco-api.onrender.com
```

configura EAS con esa URL para produccion:

```powershell
cd apps/mobile
pnpm dlx eas-cli env:create --environment production --name API_URL --value https://fbmaniaco-api.onrender.com
cd ../..
pnpm --filter @fbmaniaco/mobile build:android:production
```

Tambien puedes compilar localmente en la misma terminal:

```powershell
$env:API_URL="https://fbmaniaco-api.onrender.com"
$env:APP_VARIANT="production"
pnpm --filter @fbmaniaco/mobile build:android:production
```

## 3. Reconexion de Meta

Si el token anterior estaba expirado, abre la app nueva y reconecta Facebook. Una vez reconectado, la API publica guardara la sesion en Supabase Storage y el celular ya no dependera de esta PC.
