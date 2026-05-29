# Cadencia — Documento de diseño técnico

Aplicación para Android para crear y publicar contenido en páginas de Facebook usando Meta Graph API y generación de imágenes y texto con IA.

---

## 1. Glosario

| Término | Significado |
|---|---|
| **Página** | Página de Facebook administrada por el usuario. |
| **Lote** | Conjunto de variantes generadas en una misma corrida del flujo de publicación. |
| **Variante** | Una publicación individual (imagen generada + texto) derivada de una foto base. |
| **Foto base** | Foto original subida por el usuario, antes de aplicar variantes. |
| **Estilo** | Frase corta que define el ambiente/fondo a aplicar en una variante. |
| **Contexto** | Descripción textual del contenido de una foto, generada por IA o por el usuario. |
| **Flujo de publicación** | Proceso completo desde selección de fotos hasta publicación en Facebook. |
| **PAT** | Page Access Token. Token de Meta Graph API que permite operar sobre una página. |
| **Lote archivado** | Lote cuyas variantes ya se publicaron todas y queda guardado como histórico. |

---

## 2. Stack tecnológico y lenguajes

| Capa | Tecnología | Lenguaje | Función |
|---|---|---|---|
| App móvil | Expo (React Native) + Expo Router + `react-native-paper` (Material 3) | **TypeScript** | UI Android (e iOS a futuro sin reescribir) |
| Backend (worker) | Node.js en Render | **TypeScript** | Procesamiento pesado, cola, llamadas a IA y Meta |
| Edge functions | Supabase Edge Functions (Deno runtime) | **TypeScript** | Endpoints ligeros, webhooks |
| Base de datos | Supabase Postgres | **SQL** (Postgres) | Metadata, lotes, calendario, tokens |
| Migraciones | Supabase CLI | **SQL** | Versionado del esquema |
| Realtime | Supabase Realtime | — | Empuja avances al cliente |
| Storage | Supabase Storage al arrancar; Cloudflare R2 al escalar | — | Archivos de imagen |
| Build mobile | EAS Build (Expo Application Services) | **YAML** (`eas.json`) | Compilación Android (.aab / .apk) |
| OTA updates | EAS Update | — | Parches sin pasar por Play Store |
| CI/CD | GitHub Actions | **YAML** | Tests, lint, deploy, builds |
| API externa de imagen | OpenAI GPT Image 2 (principal); opcionales: Imagen 3 (Google), Nano Banana Pro (Gemini) | — | Generación de variantes |
| API externa de texto | LLM multimodal tipo GPT-4o-mini | — | Contextualización y copy |
| API de Facebook | Meta Graph API | — | OAuth, páginas, publicación |

**Justificación de las elecciones de lenguaje:**
- **TypeScript en toda la stack** (mobile + backend + edge functions): un solo lenguaje, tipos compartidos entre cliente y servidor, alta productividad con agentes de código.
- **SQL nativo** para esquema y migraciones (no ORM "mágico") para que las reglas de aislamiento (§5) y RLS queden explícitas y auditables.
- **YAML** solo donde la herramienta lo exige (EAS, GitHub Actions).
- **No se usa Kotlin/Java** porque la app va por Expo + React Native. Si en el futuro se necesita acceso a APIs Android no cubiertas por Expo, se puede agregar un módulo nativo con Kotlin como excepción.

---

## 3. Arquitectura del sistema

### 3.1 Componentes y responsabilidades

- **App móvil (Expo + React Native):** renderiza UI, captura entradas, sube fotos al backend, dispara órdenes de lote, consulta y muestra estado. No realiza generación ni publicación directa.
- **Backend (Node.js en Render):** recibe órdenes, ejecuta contextualización, generación de imágenes y texto, programación y publicación. Maneja cola y rate limits con proveedores de IA. Actualiza Supabase con avances.
- **Supabase:** Postgres con metadata, Auth para sesión, Realtime para empujar avances a la app, Storage inicial de imágenes (migrable a R2).
- **Meta Graph API:** OAuth de Facebook, lectura de páginas administradas, publicación de contenido.

### 3.2 Principios de diseño

1. **Stateless en móvil:** la app no es fuente de verdad. Supabase lo es.
2. **Aislamiento por página:** los datos de cada página son independientes (ver §5).
3. **Idempotencia:** el backend debe poder reintentar pasos del flujo sin duplicar publicaciones.
4. **Resiliencia:** un lote en progreso sobrevive a cierre de app, apagado del teléfono y cambio de dispositivo.
5. **Tipos compartidos:** un paquete `shared/` con tipos TypeScript usados tanto por mobile como por backend, generados a partir del esquema de Supabase.

---

## 4. Modelo de datos (esquema sugerido)

> Todas las tablas con `page_id` se filtran estrictamente por la página activa. Usar Row Level Security (RLS) de Supabase para enforced el aislamiento a nivel de base de datos.

### 4.1 Tablas

**users**
- `id` (uuid, PK)
- `fb_user_id` (text)
- `long_lived_user_token` (text, cifrado)
- `created_at`, `updated_at`

**pages**
- `id` (uuid, PK)
- `user_id` (FK → users.id)
- `fb_page_id` (text, único)
- `name`, `cover_url`, `profile_url`
- `page_access_token` (text, cifrado, no expira)
- `settings` (jsonb) — ver §13

**photos**
- `id` (uuid, PK)
- `page_id` (FK → pages.id) — aislamiento
- `storage_path` (text)
- `context` (text)
- `context_source` (enum: `ai`, `manual`)
- `created_at`

**batches**
- `id` (uuid, PK)
- `page_id` (FK → pages.id) — aislamiento
- `status` (enum: ver §9.9)
- `variants_per_photo` (int, 1–10)
- `distribution_days` (int)
- `skip_review` (boolean)
- `created_at`, `archived_at`

**variants**
- `id` (uuid, PK)
- `batch_id` (FK → batches.id)
- `source_photo_id` (FK → photos.id)
- `style` (text)
- `generated_image_path` (text, nullable)
- `generated_text` (text, nullable)
- `user_text_override` (text, nullable)
- `status` (enum: `pending`, `generating`, `ready`, `approved`, `rejected`, `scheduled`, `published`, `failed`)
- `scheduled_at` (timestamptz, nullable)
- `fb_post_id` (text, nullable)

**styles_history**
- `id` (uuid, PK)
- `page_id` (FK → pages.id)
- `style` (text)
- `batch_id` (FK → batches.id)
- `used_at`

### 4.2 Reglas de integridad

- Toda query incluye el `page_id` activo.
- Ninguna query cruza entre `page_id`s distintos.
- RLS en Supabase enforced que cada usuario solo accede a sus páginas y sus datos relacionados.

---

## 5. Aislamiento entre páginas (regla crítica)

A partir del momento en que se selecciona una página, **los datos de esa página son completamente independientes de los demás**, ni en el código ni en la práctica.

Debe garantizarse:

- **En código:** todas las queries, llamadas y operaciones reciben el `page_id` activo como filtro obligatorio. No existe ninguna ruta que mezcle datos de páginas distintas.
- **En base de datos:** RLS bloquea cualquier acceso fuera de la página activa.
- **En UI:** la página activa es visible en todo momento. Cambiar de página implica recargar contexto desde cero.
- **En tokens:** cada página tiene su propio PAT; nunca usar el PAT de otra página.

Esto aplica a galería, configuración, lotes, calendario, historial de estilos, tokens y cualquier dato derivado.

---

## 6. Autenticación y manejo de sesión

### 6.1 Login (una sola vez)

1. Usuario abre la app por primera vez → pantalla de login con Facebook.
2. App invoca Facebook OAuth (vía `expo-auth-session` con el SDK de Facebook).
3. Permisos requeridos: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `public_profile`.
4. Se recibe un **short-lived user access token** (~1 h).
5. El backend lo intercambia por un **long-lived user access token** (~60 días).
6. El backend solicita y guarda los **Page Access Tokens** de cada página administrada. Los PATs no expiran salvo cambio de contraseña o revocación.
7. Los PATs se almacenan cifrados en Supabase. Nunca en el dispositivo.

### 6.2 Persistencia de sesión

La sesión permanece abierta aunque:
- Se cierre la app por mucho tiempo.
- Se apague el teléfono.
- Se actualice o reinstale la app.
- Se cambie de dispositivo.

Si el long-lived user token se invalida, el backend intenta refresco automático. Si falla, se solicita re-login.

### 6.3 Recuperación en otro dispositivo

Al iniciar sesión en cualquier dispositivo con la misma cuenta, la app recupera desde Supabase:
- Lista de páginas con sus metadatos.
- Galería completa por página.
- Lotes históricos y en curso.
- Calendario.
- Configuración por página.

(Los tokens permanecen en backend; el cliente nunca los manipula.)

Nada se guarda solo localmente. La fuente de verdad es siempre Supabase.

---

## 7. Pantallas y navegación

### 7.1 Mapa de pantallas

```
[Login con Facebook]   (solo primera vez)
        │
        ▼
[Selección de página]  ← landing al abrir la app cuando ya hay sesión
        │
        ▼
[Pantalla principal de página]
        │
        ├── Pestaña: Galería
        ├── Pestaña: Crear publicaciones  →  Flujo de publicación (§9)
        └── Pestaña: Configuración
```

### 7.2 Login
Pantalla única con botón "Continuar con Facebook". No se vuelve a mostrar salvo pérdida de sesión.

### 7.3 Selección de página
Listado vertical de todas las páginas a las que el usuario tiene acceso. Cada elemento muestra:
- Nombre.
- Foto de portada.
- Foto de perfil.

Tap → entra a la pantalla principal de esa página.

### 7.4 Pantalla principal de página
De arriba hacia abajo:
- **Encabezado:** nombre + portada + foto de perfil.
- **Calendario minimalista:** versión simplificada del calendario del planificador de Meta Business Suite. Muestra lo programado y lo publicado. Se lee desde Supabase, no desde Facebook.
- **Barra de pestañas:** Galería · Crear publicaciones · Configuración.

### 7.5 Pestaña: Galería
Grid de fotos de la página, cada una con miniatura y acceso a su contexto. Acciones:
- Tap → detalle (foto + contexto editable manualmente).
- Selección múltiple → "Crear publicaciones con seleccionadas" (entra al flujo de publicación a partir del paso 3).

### 7.6 Pestaña: Configuración
Ajustes propios de la página activa. Campos: ver §13.

### 7.7 Pestaña: Crear publicaciones
Entrada al flujo de publicación (§9).

---

## 8. Galería de la página

- Contiene todas las fotos subidas para esa página.
- Cada foto está clasificada por su descripción/contexto.
- Cualquier foto que se suba al backend (vía el flujo de publicación) se añade automáticamente a la galería con su contexto registrado.
- La galería es por página; nunca se comparte entre páginas (§5).

---

## 9. Flujo de publicación

Entrada: pestaña "Crear publicaciones" o selección desde la pestaña "Galería". Pasos secuenciales:

### 9.1 Paso 1 — Selección de fotos
**Input:** fotos seleccionadas desde la galería de la app (ya contextualizadas) y/o desde la galería del teléfono (nuevas, vía `expo-image-picker`).
**Salida:** lista de fotos a procesar en este lote.
**Efecto colateral:** las fotos nuevas se suben al backend y se añaden a la galería de la página activa.

### 9.2 Paso 2 — Contextualización
Solo para fotos sin contexto previo. El usuario elige (por foto o en lote):
- **Automática por IA multimodal** (modo por defecto). Modelo barato tipo GPT-4o-mini.
- **Manual:** el usuario escribe el contexto.

**Reglas:**
- El contexto queda ligado a la foto permanentemente.
- Una foto ya contextualizada salta este paso.

### 9.3 Paso 3 — Cantidad de variantes
**Input:** entero entre **1 y 10**, indicado por el usuario.
**Significado:** cuántas variantes se generan a partir de cada foto seleccionada.
La app asigna aleatoriamente la cantidad correspondiente a cada foto.

### 9.4 Paso 4 — Asignación de estilos
A cada variante se le asigna un estilo del catálogo (§10), respetando las reglas de aleatoriedad (§11).

### 9.5 Paso 5 — Generación de imagen y texto
Ocurre en el backend, **transparente para el usuario**. Por cada variante se ejecutan **dos peticiones separadas a la IA** (separadas por calidad del resultado, no expuesto al usuario):

**Petición 1 — Imagen**
- Modelo: GPT Image 2 (OpenAI).
- Prompt fijo (no modificar):
  ```
  Corrige la iluminación y los colores. Cambia el fondo a {estilo}
  ```

**Petición 2 — Texto**
- Modelo: LLM multimodal o de texto.
- Inputs: contexto de la foto + identidad de la página + estilo aplicado + palabras de SEO.
- Output: copy listo para publicar en Facebook.

**Modelo principal y alternativas:**
- Principal: GPT Image 2.
- Opcional combinable (configurable a futuro): Imagen 3 de Google, Nano Banana Pro de Gemini. Modo por defecto: solo GPT Image.

**Cola y rate limits:**
- El backend despacha en paralelo dentro del tier de OpenAI.
- Para escalar throughput se sube de **usage tier** (Tier 1 → Tier 5). No se intenta multiplicar API keys de la misma cuenta (los rate limits son por organización).

### 9.6 Paso 6 — Revisión y aprobación
La app presenta las variantes una por una. El usuario puede:
- **Aceptar.**
- **Rechazar** (la variante no se publica).
- **Modificar manualmente el texto** y aceptar.

Opción **"saltar revisión"**: aprueba automáticamente todas las variantes del lote (`skip_review = true`).

### 9.7 Paso 7 — Programación
La app pregunta en cuántos días distribuir las publicaciones del lote. Ver algoritmo en §12.

Ejemplo: 14 variantes en 7 días → 2 publicaciones por día.

### 9.8 Paso 8 — Publicación y archivado
- A medida que llega el `scheduled_at`, el backend publica la variante en Facebook usando el PAT.
- Se guarda el `fb_post_id` devuelto por Facebook.
- Cuando todas las variantes del lote están publicadas, el lote pasa a `archived` automáticamente.

### 9.9 Estados de un lote (state machine)

```
queued
   │
   ▼
generating ──────────────┐
   │                     │
   ▼                     │
awaiting_review ─┐       │
   │             │       │
   │  (skip_review=true) │
   ▼             ▼       │
scheduling ◄────┘        │
   │                     │
   ▼                     │
publishing               │
   │                     │
   ▼                     │
archived                 │
                         │
        failed  ◄────────┘   (cualquier paso puede dejar el lote en failed con razón persistida)
```

Si `skip_review = true`, `awaiting_review` se omite.

---

## 10. Catálogo de estilos

30 estilos, frases cortas de 1 a 4 palabras:

| # | Estilo | # | Estilo |
|---|---|---|---|
| 1 | Atardecer | 16 | Bosque con neblina |
| 2 | Pueblo | 17 | Cantina vintage |
| 3 | Amanecer en la playa | 18 | Jardín japonés |
| 4 | Feria | 19 | Viñedo en cosecha |
| 5 | Jungla | 20 | Muelle al amanecer |
| 6 | Fiesta | 21 | Pueblo nevado |
| 7 | Fiesta mexicana | 22 | Carretera entre nubes |
| 8 | Feria del pueblo | 23 | Patio colonial |
| 9 | Restaurante | 24 | Templo zen con bambú |
| 10 | Restaurante de montaña | 25 | Azotea con luces cálidas |
| 11 | Picnic en el río | 26 | Tianguis de barrio |
| 12 | Día de campo | 27 | Hoguera nocturna |
| 13 | Cabaña junto al fuego | 28 | Calle empedrada |
| 14 | Terraza en la sierra | 29 | Glamping estrellado |
| 15 | Mercado nocturno de Tokio | 30 | Tatami con cerezos |

### Plantilla de prompt (no modificar)

```
Corrige la iluminación y los colores. Cambia el fondo a {estilo}
```

Esta frase está validada empíricamente para GPT Image 2. Debe usarse literalmente.

---

## 11. Reglas de aleatoriedad de estilos

Sea `S` el catálogo de 30 estilos. La asignación de estilos a variantes debe ser **100% aleatoria** sujeta a estas restricciones, en este orden de prioridad:

1. **Sin repetición dentro de las variantes de una misma foto del lote.**
2. **Sin repetición dentro de todo el lote**, hasta agotar los 30 estilos. Si el lote requiere más de 30 variantes, se permite reutilizar respetando la regla 1.
3. **Evitar repetición respecto a lotes recientes de la misma página.** Mantener `styles_history` y priorizar los estilos menos usados recientemente.

**Implementación sugerida:**
1. Construir el universo permitido aplicando reglas 1 y 2.
2. Ordenar por "menos usado recientemente" (regla 3).
3. Aplicar shuffle controlado sobre los candidatos para preservar aleatoriedad real.
4. Registrar la asignación en `styles_history`.

---

## 12. Algoritmo de programación (calendario)

**Inputs:**
- `N` = número de variantes aprobadas del lote.
- `D` = número de días en que distribuir (input del usuario).
- Calendario actual de la página (slots ocupados).
- `business_hours` = ventana horaria preferida de la página (ej. 09:00–20:00, configurable, ver §13).

**Output:**
- `scheduled_at` para cada variante.

**Pasos:**
1. `posts_per_day = ceil(N / D)`.
2. Para cada día `d` en los próximos `D` días (desde hoy o mañana, configurable):
   1. Leer slots ocupados del calendario para el día `d`.
   2. Generar slots candidatos en este orden de preferencia:
      - Dentro de `business_hours`.
      - Resto del día (fallback si la ventana comercial está saturada).
   3. Filtrar slots libres.
   4. Reservar `posts_per_day` slots distribuidos a lo largo del día.
3. Asignar variantes (en orden o aleatoriamente) a los slots resultantes.
4. Persistir `scheduled_at` en cada variante y actualizar el calendario.

**Notas:**
- El calendario vive en Supabase. La app lo consulta vía Realtime.
- Si en el futuro se decide delegar el disparo a Facebook vía `scheduled_publish_time` de Graph API, el algoritmo no cambia; solo el mecanismo de publicación.

---

## 13. Configuración por página

Campos almacenados en `pages.settings` (jsonb):

| Campo | Tipo | Descripción |
|---|---|---|
| `seo_keywords` | string[] | Palabras inyectadas al prompt de texto. Ej. `["sushi", "tapalpa"]`. |
| `business_hours` | `{start, end}` | Ventana horaria preferida para programar. Ej. `{ "start": "09:00", "end": "20:00" }`. |
| `preferred_image_models` | string[] | Modelos de imagen activos. Por defecto `["gpt_image_2"]`. |
| `default_context_mode` | enum | `ai` o `manual`. Modo por defecto al contextualizar. |
| `skip_review_default` | boolean | Si el flujo salta revisión sin preguntar. |

(Cada página tiene su propia configuración; nunca compartida.)

---

## 14. Procesamiento en segundo plano (backend)

Todo el trabajo pesado vive en el backend, no en el teléfono. Cubre:
- Contextualización con IA.
- Generación de imágenes y textos.
- Programación.
- Publicación.

La app solo:
1. Envía la "orden de lote" al backend.
2. Consulta estado al abrirse.
3. Recibe actualizaciones en tiempo real vía Supabase Realtime.

**Garantías:**
- El lote sobrevive a cierres de app, apagado del teléfono y cambio de dispositivo.
- Cada paso del flujo es idempotente y reintentable.
- Cualquier fallo deja el lote en estado `failed` con razón persistida y recuperable.

---

## 15. Expansión futura

La arquitectura debe estar preparada para incorporar después, sin reescritura mayor:
- Generación de imágenes con Canva.
- Generación de videos con IA.
- Otros tipos de contenido.

Esto implica que el modelo `variants` y el flujo de publicación deben tener punto de extensión por tipo, ej. campo `variant_type`: `'ai_image'`, `'canva_image'`, `'ai_video'`, etc. En esta primera versión solo se implementa `'ai_image'`.

---

## 16. Diseño de interfaz (UI)

Diseño basado en convenciones de apps profesionales del sector (Meta Business Suite, Buffer, Later) y en Material 3 implementado vía `react-native-paper` sobre Expo.

### 16.1 Principios visuales

1. **Minimalista, no escueto.** Más cercano a Buffer/Later que a Hootsuite. Espacio en blanco generoso, sin paneles densos.
2. **Foco en contenido.** Las fotos son protagonistas: ocupan la mayor proporción de pantalla en galería y revisión.
3. **Una acción primaria por pantalla.** Resaltada con FAB o botón primario lleno; el resto, jerarquía baja.
4. **Material 3** vía `react-native-paper`, con tokens centralizados en un `theme.ts`. Soporte para tema claro/oscuro automático según sistema.
5. **Touch-first.** Targets mínimos 48dp. Gestos esperados: swipe-to-dismiss en revisión, pull-to-refresh en listas (`react-native-gesture-handler`).
6. **Identidad neutra y profesional.** No mimetizar Facebook (azul corporativo) para no confundir; usar paleta propia.

### 16.2 Sistema de diseño

#### Color

| Token | Light | Dark | Uso |
|---|---|---|---|
| `primary` | `#5B5BD6` | `#B4B4FF` | Botones primarios, FAB, énfasis |
| `onPrimary` | `#FFFFFF` | `#1A1A4A` | Texto sobre primary |
| `primaryContainer` | `#E4E4FF` | `#3A3A8A` | Fondos suaves de énfasis |
| `secondary` | `#FF8A4C` | `#FFB587` | Acentos cálidos, badges |
| `surface` | `#FAFAFA` | `#121212` | Fondo principal |
| `surfaceContainer` | `#F2F2F5` | `#1E1E22` | Cards, sheets |
| `onSurface` | `#1A1A1A` | `#E6E6E6` | Texto principal |
| `onSurfaceVariant` | `#5A5A60` | `#A8A8B0` | Texto secundario |
| `outline` | `#C4C4CC` | `#44444A` | Bordes sutiles |
| `success` | `#16A34A` | `#4ADE80` | Estados ok, publicado |
| `warning` | `#F59E0B` | `#FCD34D` | Estados intermedios, programado |
| `error` | `#DC2626` | `#F87171` | Errores, rechazado |

Implementación: `MD3LightTheme` y `MD3DarkTheme` de `react-native-paper` con `colors` extendido. Selección automática vía `useColorScheme()` de RN.

#### Tipografía
Fuente: **Inter** (cargada con `expo-google-fonts/inter`), con fallback al sistema.

| Estilo | Tamaño | Weight | Uso |
|---|---|---|---|
| Display L | 32sp | 600 | Bienvenida, pantalla de login |
| Headline | 24sp | 600 | Nombres de página, títulos de paso |
| Title L | 18sp | 600 | Encabezados de sección |
| Title M | 16sp | 600 | Títulos de card |
| Body L | 16sp | 400 | Texto principal, copy de publicación |
| Body M | 14sp | 400 | Texto secundario |
| Label L | 14sp | 500 | Botones, etiquetas |
| Label M | 12sp | 500 | Captions, timestamps, chips |

#### Espaciado (escala 4dp)
`4, 8, 12, 16, 20, 24, 32, 48, 64`

- Padding estándar de pantalla: **16dp** horizontal.
- Separación entre cards: **12dp**.
- Gutter del grid de fotos: **8dp**.
- Margen vertical entre secciones: **24dp**.

#### Radios
- Small: 8dp (chips, botones pequeños).
- Medium: 16dp (cards, inputs, botones primarios).
- Large: 24dp (bottom sheets, modales).
- Full: 50% (avatares, FAB).

#### Elevación
- 0dp: fondos planos.
- 1dp: cards en reposo.
- 3dp: FAB y app bars elevados.
- 6dp: bottom sheets modales, diálogos.

#### Iconografía
Material Symbols vía `@expo/vector-icons` (`MaterialCommunityIcons` o `MaterialIcons`). Tamaños: 20dp en chips/labels, 24dp en barras/tabs, 28dp en encabezados.

### 16.3 Navegación

- Implementada con **Expo Router** (file-based).
- **Top-level pre-sesión:** Login (única pantalla).
- **Top-level post-sesión:** Selección de página como root cuando no hay página activa; Pantalla principal de página cuando sí la hay.
- **Dentro de la página:** tabs con `Material Top Tabs Navigator` (3 destinos: Galería · Crear · Configuración).
- **Switch de página:** avatar de la página activa en la esquina superior derecha → tap abre `BottomSheet` (`@gorhom/bottom-sheet`) con el listado de páginas.

### 16.4 Layouts de pantalla (wireframes)

#### 16.4.1 Login

```
┌─────────────────────────────────────┐
│                                     │
│                                     │
│           [logo Cadencia]            │
│                                     │
│                                     │
│       Publica en Facebook sin       │
│           pensar en horarios        │
│                                     │
│                                     │
│   ┌─────────────────────────────┐   │
│   │  Continuar con Facebook  ➜  │   │  ← botón primario, 56dp
│   └─────────────────────────────┘   │
│                                     │
│   Al continuar aceptas los          │
│   Términos y la Política de         │  ← label M, onSurfaceVariant
│   privacidad.                       │
│                                     │
└─────────────────────────────────────┘
```

#### 16.4.2 Selección de página

```
┌─────────────────────────────────────┐
│  ←   Tus páginas               ⚙   │  ← top app bar
├─────────────────────────────────────┤
│                                     │
│  ┌───────────────────────────────┐  │
│  │ ╔═══════════════════╗   ●     │  │  ← card de página
│  │ ║   PORTADA         ║         │  │   - portada 16:9
│  │ ╚═══════════════════╝         │  │   - avatar circular
│  │  ◯  Sushi Vida Tapalpa        │  │     superpuesto
│  │     12 lotes · 3 programados  │  │   - nombre + meta
│  └───────────────────────────────┘  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ ╔═══════════════════╗         │  │
│  │ ║   PORTADA         ║         │  │
│  │ ╚═══════════════════╝         │  │
│  │  ◯  Otra Página               │  │
│  │     5 lotes · 0 programados   │  │
│  └───────────────────────────────┘  │
│                                     │
│  …                                  │
└─────────────────────────────────────┘
```

Lista vertical scrollable con `FlashList` (Shopify) para performance con muchas páginas.

#### 16.4.3 Pantalla principal de página

```
┌─────────────────────────────────────┐
│  ╔═══════════════════════════╗ ⌃   │  ← portada como banner
│  ║       PORTADA             ║      │   altura ~140dp
│  ╚═══════════════════════════╝      │
│  ◯ Sushi Vida Tapalpa               │  ← avatar + nombre,
│    Restaurante · Tapalpa            │     onSurface
│                                     │
│ ─── Próximas publicaciones ───      │  ← title L
│                                     │
│  Lun 28      Mar 29      Mié 30     │  ← chips de día,
│   ●●          ●           ●●         │     scroll horizontal
│  Jue 1       Vie 2       Sáb 3      │
│   ●           —           ●●●        │
│                                     │
│  [Ver calendario completo →]        │  ← link text
│                                     │
├─────────────────────────────────────┤
│  📷 Galería │ ➕ Crear │ ⚙ Ajustes  │  ← Top tabs
└─────────────────────────────────────┘
```

#### 16.4.4 Pestaña Galería

```
┌─────────────────────────────────────┐
│  Galería              🔍   ⋮         │
│                                     │
│  [Todas] [Sin contexto] [Recientes] │  ← filtros chips
│                                     │
│  ┌────┬────┬────┐                   │
│  │📷  │📷  │📷  │                   │  ← grid 3 columnas
│  │    │    │    │                   │     vía FlashList
│  ├────┼────┼────┤                   │     numColumns=3
│  │📷  │📷  │📷  │                   │
│  │    │    │    │                   │
│  ├────┼────┼────┤                   │
│  │📷  │📷  │📷  │                   │
│  └────┴────┴────┘                   │
│                                     │
│                              ╭───╮  │
│                              │ ➕ │  │  ← FAB extendido
│                              ╰───╯  │
└─────────────────────────────────────┘
```

Long-press → modo selección múltiple con app bar contextual. FAB → `expo-image-picker` con `allowsMultipleSelection`.

#### 16.4.5 Pestaña Configuración

```
┌─────────────────────────────────────┐
│  Configuración                       │
│                                     │
│ ─── Publicaciones ───                │
│  Palabras de SEO                     │
│  sushi, tapalpa                  ›  │
│                                     │
│  Horario preferido                   │
│  09:00 – 20:00                   ›  │
│                                     │
│  Saltar revisión por defecto         │
│                                  ◯  │  ← switch
│                                     │
│ ─── IA ───                           │
│  Modelo de imagen                    │
│  GPT Image 2                     ›  │
│                                     │
│  Modo de contextualización           │
│  Automático con IA               ›  │
│                                     │
│ ─── Cuenta ───                       │
│  Cambiar página activa           ›  │
│  Cerrar sesión                   ›  │
└─────────────────────────────────────┘
```

Cada fila con `List.Item` de `react-native-paper`. Editores en bottom sheets.

#### 16.4.6 Flujo de publicación

Stepper de pantalla completa con barra superior de progreso. Cada paso ocupa toda la pantalla. Botón "Atrás" y botón primario "Siguiente" abajo, en `BottomActionBar` fijo.

Plantilla común:

```
┌─────────────────────────────────────┐
│  ← Paso 3 de 8                   ⋮  │
│  ━━━━━━━━━░░░░░░░░░░░░             │  ← ProgressBar
│                                     │
│  Cantidad de variantes               │  ← headline
│  ¿Cuántas variantes quieres por     │
│   foto?                              │  ← body sutil
│                                     │
│       [ contenido del paso ]         │
│                                     │
│                                     │
│ ┌──────────┐  ┌─────────────────┐   │
│ │  Atrás   │  │   Siguiente   ➜ │   │
│ └──────────┘  └─────────────────┘   │
└─────────────────────────────────────┘
```

**Paso 1 — Selección de fotos.** Pestañas internas: "Galería de la app" / "Galería del teléfono". Grid de fotos con check. Contador "n seleccionadas".

**Paso 2 — Contextualización.** Lista de fotos pendientes. Por foto: miniatura + radio "Auto IA" / "Manual". Si "Manual", text field debajo. Acción de lote: "Asignar Auto IA a todas".

**Paso 3 — Cantidad de variantes.** Slider grande horizontal de 1 a 10. Valor central en Display L. Texto: "Se generarán hasta {N × fotos} variantes en este lote".

**Paso 4 — Asignación de estilos.** Preview animado de la asignación (efecto ruleta sobre los chips de estilo). Continuar lleva al paso 5.

**Paso 5 — Generación.** Lista de variantes con estado en vivo (`pending`, `generating`, `ready`). Botón "Cerrar app sin perder progreso" — explica que el backend sigue trabajando.

**Paso 6 — Revisión.** Carrusel swipeable (`react-native-gesture-handler` + `react-native-reanimated`): imagen 4:5 + texto editable + botones ❌ Rechazar · ✏ Editar · ✅ Aceptar. Indicador "3 de 14". Acción superior: "Saltar revisión".

**Paso 7 — Programación.** Input numérico "Distribuir en cuántos días". Preview del calendario resultante: días con chips de slots. Drag de un chip a otro día permite ajustar.

**Paso 8 — Resumen y confirmación.** Lista compacta: foto + fecha/hora. Botón primario "Confirmar y programar". Pantalla de éxito con animación Lottie y opción "Ver en calendario".

### 16.5 Componentes reutilizables

| Componente | Equivalente React Native | Uso |
|---|---|---|
| `PageCard` | `Card` (paper) + `View` con offset para avatar | Listado de páginas |
| `PhotoTile` | `Pressable` + `Image` + AspectRatio | Grid de galería |
| `StyleChip` | `Chip` (paper) | Mostrar estilo asignado |
| `StatusBadge` | `Chip` (paper, modo `flat`) | Estado de variante/lote |
| `MinimalCalendarStrip` | Composición propia + `FlatList` horizontal | Calendario semanal de la portada |
| `VariantCard` | `Card` + `Image` + `TextInput` (paper) | Card de revisión |
| `StepperTopBar` | `Appbar.Header` + `ProgressBar` (paper) | Stepper del flujo |
| `PrimaryActionButton` | `Button mode="contained"` (paper) | CTA primario, altura 56dp |
| `BottomActionBar` | `Surface` + `Button` row | Barra inferior fija Atrás/Siguiente |
| `PageSwitcherSheet` | `BottomSheetModal` (`@gorhom/bottom-sheet`) | Cambio de página activa |
| Lista virtualizada | `FlashList` (`@shopify/flash-list`) | Galerías y listados largos |
| Picker de imagen | `expo-image-picker` | Subir fotos del teléfono |
| Caché de imágenes | `expo-image` | Render eficiente |

### 16.6 Estados de UI

Cada pantalla con contenido remoto debe manejar explícitamente:

- **Loading:** skeleton (shimmer) que respeta el layout final. Implementable con `react-native-reanimated`.
- **Empty:** ilustración + mensaje + CTA. Ej. galería vacía → "Aún no hay fotos. Sube las primeras".
- **Error:** mensaje + botón "Reintentar". Persistir últimos datos válidos si los hay.
- **Success / hecho:** `Snackbar` (paper) con acción opcional ("Lote programado · Ver calendario").
- **Offline:** banner sutil en parte superior; cola local de intenciones que se sincronizan al volver la red (`@react-native-community/netinfo`).

### 16.7 Microinteracciones y feedback

- **Animación de progreso de lote** (paso 5): por cada variante que pasa a `ready`, ripple en su fila + counter "n / total" arriba (Reanimated + Realtime).
- **Swipe accept/reject** en revisión: derecha acepta, izquierda rechaza. Tap largo → preview a pantalla completa.
- **Haptic feedback** (`expo-haptics`) en confirmaciones críticas.
- **Transiciones** entre pasos del stepper con `react-native-reanimated` (shared transitions cuando aplique).

### 16.8 Accesibilidad

- Targets táctiles mínimos 48dp.
- Contraste ≥ 4.5:1 en texto Body; ≥ 3:1 en Display.
- `accessibilityLabel` y `accessibilityRole` en todos los elementos interactivos.
- Soporte para tamaños de texto del sistema (`PixelRatio.getFontScale()`).
- Lector de pantalla: navegación coherente paso a paso en el stepper.
- Modo oscuro con tokens equivalentes.

### 16.9 Referencias visuales

Inspiración tomada de:
- **Meta Business Suite mobile** — tabs por área, calendario "Planner" como vista central, "switch de cuenta".
- **Buffer** — minimalismo, una acción primaria por pantalla, stepper para crear publicaciones.
- **Later** — calendario visual y drag-to-reschedule.
- **Google Photos** — grid con multi-selección y bottom sheet de detalle.
- **Material 3** — color dinámico, tabs primary y bottom sheets como contenedor estándar.

---

## 17. Configuración inicial y secretos

Esta sección describe **todos los secretos necesarios** para que la primera versión de la app funcione end-to-end, **dónde se usa cada uno** y **cuándo el agente de código (Codex) debe pedírselos al usuario**. Codex no debe pedir todo al inicio: cada secreto se solicita justo antes de implementar la capa que lo necesita.

### 17.1 Inventario de secretos

| Secreto | Capa donde se usa | Sensibilidad | Cómo se obtiene |
|---|---|---|---|
| `META_APP_ID` | mobile + backend | Pública (puede vivir en cliente) | Crear app en Meta Developers → "Settings → Basic" |
| `META_APP_SECRET` | backend solamente | **Alta** (nunca al cliente) | Meta Developers → "Settings → Basic → App Secret" |
| `META_USER_TOKEN` (inicial, dev) | backend (dev local) | **Alta** | Graph API Explorer; sirve para probar antes de tener OAuth funcional |
| `SUPABASE_ACCESS_TOKEN` | dev / CLI | **Alta** | Supabase Dashboard → Account → Access tokens |
| `SUPABASE_SERVICE_ROLE` | backend | **Muy alta** | Supabase project → Settings → API → Service role key |
| `DATABASE_URL` | backend | **Alta** | Supabase project → Settings → Database → Connection string |
| `OPENAI_API_KEY` | backend | **Alta** | platform.openai.com → API keys |
| `RENDER_API_KEY` | dev / CI | **Alta** | dashboard.render.com → Account Settings → API Keys |
| `EXPO_TOKEN` | dev / CI | **Alta** | expo.dev → Account → Access tokens |
| **Credenciales Android** (keystore + alias + 2 passwords) | EAS Build | **Muy alta** | Generadas por EAS ("managed credentials"); o aportadas por el usuario si las maneja él |

### 17.2 Orden de configuración (instrucciones para Codex)

Codex debe seguir este orden y pedir cada secreto **justo cuando lo necesita**, no antes. Si un secreto no está disponible al momento de necesitarlo, Codex se detiene y lo solicita en chat antes de continuar.

#### Etapa 0 — Bootstrap del repo
- Sin secretos. Codex crea estructura: `mobile/`, `backend/`, `supabase/`, `shared/`.
- Configura TypeScript, ESLint y Prettier en cada paquete.
- Crea archivos `.env.example` por paquete (vacíos), añade `.env` al `.gitignore`.

#### Etapa 1 — Esquema de base de datos
1. Codex pide al usuario: **`SUPABASE_ACCESS_TOKEN`**.
2. Codex pide al usuario: **referencia/ID del proyecto Supabase** (no es secreto pero hace falta).
3. Vincula proyecto con el CLI (`supabase link`).
4. Crea migraciones iniciales en SQL (tablas de §4) y RLS policies (§5).
5. Ejecuta `supabase db push`.

#### Etapa 2 — Backend mínimo (Node.js + TypeScript)
6. Codex pide al usuario: **`SUPABASE_SERVICE_ROLE`** y **`DATABASE_URL`**.
7. Inicializa proyecto Node con cliente de Supabase para backend.
8. Implementa health check (`GET /health`) y una query mínima a la DB para validar.

#### Etapa 3 — OAuth de Facebook
9. Codex pide al usuario: **`META_APP_ID`** y **`META_APP_SECRET`**.
10. (Opcional, para probar antes de tener OAuth completo) Codex pide **`META_USER_TOKEN`** de Graph API Explorer.
11. Implementa endpoint `/auth/facebook/exchange` que recibe el short-lived token y lo cambia por long-lived; guarda PATs por página.

#### Etapa 4 — App móvil base (Expo + React Native)
12. Codex inicializa proyecto Expo con TypeScript y Expo Router.
13. Configura `react-native-paper` y el theme de §16.2.
14. Codex pide nuevamente **`META_APP_ID`** (necesario en `app.config.ts` del mobile para Facebook SDK).
15. Implementa pantallas de Login y Selección de página, conectadas al backend de la etapa 3.

#### Etapa 5 — Generación con IA
16. Codex pide al usuario: **`OPENAI_API_KEY`**.
17. Implementa en backend:
   - Servicio de contextualización (GPT-4o-mini).
   - Servicio de generación de imagen (GPT Image 2) con el prompt fijo de §10.
   - Servicio de generación de texto (paso 9.5, petición 2).
18. Implementa la cola con respeto de rate limits.

#### Etapa 6 — Flujo de publicación completo en mobile
19. No requiere secretos nuevos.
20. Codex implementa los 8 pasos del stepper (§16.4.6) consumiendo el backend.

#### Etapa 7 — Deploy del backend a Render
21. Codex pide al usuario: **`RENDER_API_KEY`**.
22. Crea el servicio en Render vía API o configuración manual guiada.
23. Configura como variables de entorno en Render: `SUPABASE_SERVICE_ROLE`, `DATABASE_URL`, `META_APP_ID`, `META_APP_SECRET`, `OPENAI_API_KEY`.

#### Etapa 8 — Build de la app con EAS
24. Codex pide al usuario: **`EXPO_TOKEN`**.
25. Inicializa `eas.json` con perfiles `development`, `preview`, `production`.
26. Para el primer build de release Android:
   - Opción A (recomendada): "managed credentials" de EAS → EAS genera y guarda el keystore. Codex solo pregunta si el usuario quiere esta opción.
   - Opción B: el usuario aporta keystore + alias + key password + keystore password. Codex los recibe por chat (con advertencia de seguridad) y los configura vía `eas credentials`.

#### Etapa 9 — CI/CD
27. Codex configura GitHub Actions con los secrets necesarios: `EXPO_TOKEN`, `RENDER_API_KEY`, `SUPABASE_ACCESS_TOKEN`.
28. Workflows mínimos: `lint`, `typecheck`, `test`, `build-mobile-preview`, `deploy-backend`.

### 17.3 Almacenamiento de secretos

| Entorno | Cómo se guardan |
|---|---|
| Desarrollo local | `mobile/.env`, `backend/.env`, `supabase/.env` (en `.gitignore`). Plantillas en `.env.example`. |
| CI (GitHub Actions) | GitHub repository secrets. |
| Backend en Render | Variables de entorno del servicio. |
| Mobile (compilado) | Solo públicos (`META_APP_ID`). Cualquier otro secreto se obtiene en runtime del backend. |
| EAS | `eas secret:create` para las que use el build (`EXPO_TOKEN` propio del CI, no del build). |

### 17.4 Reglas de seguridad

- `SUPABASE_SERVICE_ROLE`, `META_APP_SECRET`, `OPENAI_API_KEY`, `DATABASE_URL` y `META_USER_TOKEN` **nunca** se exponen al cliente móvil. Solo viven en el backend.
- El keystore de Android se guarda fuera del repo. Recomendado: gestionado por EAS.
- En logs nunca aparece el valor de un secreto. Solo el nombre y un sufijo enmascarado si es necesario para debug.
- Rotación: documentar en `SECURITY.md` el procedimiento de rotación de cada secreto, qué hay que redeployar y dónde actualizar.
- En el cliente móvil, datos sensibles (tokens si por algún motivo se almacenan localmente) usan `expo-secure-store`.

---

## 18. Criterios de aceptación

### Sesión y navegación
- [ ] El usuario inicia sesión con Facebook **una sola vez**; la sesión persiste tras cerrar la app, apagar el teléfono o reinstalar.
- [ ] La primera pantalla post-login es el listado de páginas con nombre, portada y foto de perfil.
- [ ] Cambiar de página activa siempre se hace a través del switcher; nunca se mezclan datos.
- [ ] Al seleccionar una página, ningún dato (visible o lógico) cruza con otras páginas.

### Galería
- [ ] La galería de cada página muestra todas sus fotos clasificadas por contexto.
- [ ] Fotos subidas en el flujo se añaden automáticamente a la galería con su contexto registrado.
- [ ] El usuario puede iniciar un flujo de publicación seleccionando fotos directamente desde la galería.

### Flujo de publicación
- [ ] El flujo funciona end-to-end con foto desde galería del teléfono o de la app.
- [ ] El número de variantes por foto es configurable entre **1 y 10**.
- [ ] El prompt de imagen es literalmente `Corrige la iluminación y los colores. Cambia el fondo a {estilo}`.
- [ ] No se repite ningún estilo dentro de una foto, dentro del lote (hasta 30), ni respecto a lotes recientes de la misma página.
- [ ] La generación usa GPT Image 2 por defecto; la cola respeta los rate limits del tier activo.
- [ ] Durante la revisión, el usuario puede aceptar, rechazar o **modificar manualmente** el texto de cada variante.
- [ ] La opción "saltar revisión" aprueba todas las variantes automáticamente.
- [ ] La programación distribuye N variantes en D días dando preferencia a horarios diurnos / comerciales y evitando horarios ya ocupados.
- [ ] El lote se archiva automáticamente al publicar la última variante.

### Backend / persistencia
- [ ] El procesamiento continúa con la app cerrada o el teléfono apagado.
- [ ] Al iniciar sesión en otro dispositivo, el usuario recupera galería, lotes, calendario y configuración completos.

### UI
- [ ] Cada pantalla con contenido remoto maneja explícitamente loading, empty, error y success.
- [ ] La paleta de color, tipografía y espaciado siguen los tokens definidos en §16.2.
- [ ] La app soporta modo claro y oscuro.
- [ ] Todos los targets táctiles cumplen 48dp mínimo y el contraste cumple WCAG AA.
- [ ] La barra superior del stepper muestra siempre el paso actual y el progreso del flujo.

### Configuración y secretos
- [ ] Ningún secreto sensible (Service Role, App Secret, OpenAI Key, etc.) está presente en el cliente móvil.
- [ ] Existen `.env.example` por paquete y `.env` está en `.gitignore`.
- [ ] El backend en Render tiene todas las variables de entorno necesarias configuradas.
- [ ] EAS Build genera el `.aab` de release sin pasos manuales adicionales.
