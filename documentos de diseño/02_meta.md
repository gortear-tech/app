# Modulo 1 - Conexion Meta, paginas y onboarding
### FBmaniaco Â· App movil Expo + API Fastify

## Principio de diseno

Meta/Facebook no debe ser la identidad interna de FBmaniaco. Meta es el permiso operativo para leer paginas y publicar; FBmaniaco debe tener usuario, sesion, `workspaceId` y `actorId` propios para auditoria, soporte, recuperacion y multi-negocio.

La experiencia puede seguir siendo ligera: el MVP puede iniciar con sesion anonima controlada, magic link o social login, y despues pedir conexion Meta. Lo que no debe pasar es guardar el estado del producto solo alrededor de un token Meta.

En produccion, el usuario no debe pegar tokens manuales. La ruta principal es autorizacion oficial de Meta mediante Facebook Login/OAuth, idealmente Login for Business si el tipo de app y permisos lo requieren. Device login solo se usa si Meta lo soporta para el tipo de app/configuracion vigente; no debe ser la unica ruta de produccion. Meta entrega credenciales tecnicas para listar paginas y publicar; la diferencia es que esas credenciales se reciben, renuevan y guardan en backend, nunca como texto visible administrado por el usuario.

La pantalla debe explicar en lenguaje simple:

- No usamos usuario ni contrasena de Facebook dentro de la app.
- Tu sesion de FBmaniaco protege tu negocio.
- Necesitamos autorizacion oficial de Meta para publicar en tu pagina.
- Si el acceso vence, las publicaciones quedan pausadas hasta reconectar.
- No tienes que copiar tokens: Facebook nos entrega un acceso tecnico seguro despues de que autorices la app.

## Estados de arranque

La API expone `/auth/bootstrap-status`.

Respuesta conceptual:

- `hasUsers`: hay token o usuario operativo.
- `hasActiveSession`: token valido.
- `authUserId`: usuario interno autenticado o anonimo persistente.
- `workspaceId`: espacio de trabajo activo.
- `hasSelectedBusiness`: pagina/negocio elegido.
- `facebookTokenStatus`: `valido`, `por_vencer`, `expirado`, `requiere_reconexion`, `error_permiso`, `error_desconocido` o null.
- `canStartMetaAuthorization`: la app puede iniciar OAuth/device login.
- `requiresManualToken`: solo true en modo desarrollo/soporte habilitado desde backend.
- `grantedScopes`: permisos Meta concedidos, sanitizados.
- `declinedScopes`: permisos Meta rechazados o faltantes.
- `grantedPageIds`: paginas autorizadas por permisos granulares.
- `missingRequiredScopes`: permisos requeridos que faltan.
- `metaAuthorizationStatus`: `none`, `pending`, `valid`, `missing_scopes`, `requires_review`, `expired`, `revoked`, `error`.
- `appReviewStatus`: `development`, `review_required`, `approved`, `rejected`, `unknown`.
- `graphApiVersion`: version Graph usada por backend.
- `nextStep`: `connect_meta`, `recover_meta`, `select_page` o `home`.

La app decide pantalla inicial con `resolveInitialScreen`.

## Pantalla T1 - Conectar Facebook

### Cuando aparece

- Primera instalacion sin autorizacion Meta.
- Estado `nextStep = connect_meta`.
- Reconexion si Meta expira.

### Layout

Contenedor vertical con scroll:

- Marca `FBmaniaco`.
- Fila superior:
  - boton volver;
  - titulo:
    - normal: `Conecta tu negocio`;
    - reconexion: `Reconectar Facebook`;
  - texto explicativo;
  - boton de ayuda con icono de informacion.
- Card de autorizacion:
  - titulo `Autorizar Facebook`;
  - subtitulo `Te llevaremos a Facebook para elegir las paginas que quieres conectar.`;
  - estado visible del flujo: pendiente, aprobado, expirado o error;
  - codigo y enlace de device login si aplica.
- Botones:
  - normal: `Conectar con Facebook`;
  - normal secundario si aplica: `Usar codigo de dispositivo`;
  - reconexion: `Reconectar`;
  - desarrollo/soporte: `Conectar token manual` solo si backend lo habilita.

### Comportamiento

Boton conectar con Facebook:

1. Llama `POST /auth/meta/connect`.
2. API intenta:
   - refrescar credenciales server-side si existe autorizacion previa;
   - continuar device login pendiente;
   - iniciar nuevo Facebook Login/OAuth o device login si esta soportado.
3. Si device login esta pendiente, muestra:
   - `verificationUri`;
   - `userCode`;
   - hora de vencimiento;
   - mensaje `Esperando aprobacion de Meta`.

### Permisos requeridos

Permisos base para el MVP:

- `pages_show_list`: listar paginas disponibles para el usuario.
- `pages_read_engagement`: leer metadata/engagement de paginas y posts.
- `pages_manage_posts`: publicar o programar posts en paginas.

Permisos opcionales:

- `pages_manage_metadata`: solo si se implementan webhooks/subscriptions o gestion avanzada de metadata.
- `business_management`: no pedir por defecto; evaluar solo si Login for Business o cuentas de Business Manager lo requieren para listar/operar activos. Pedirlo sin uso demostrable puede complicar App Review.

Reglas:

- Solicitar solo permisos que el flujo realmente usa y puede demostrar en App Review.
- Guardar `grantedScopes`, `declinedScopes`, `missingRequiredScopes`, `grantedPageIds`, `graphApiVersion` y `appMode`.
- No considerar conectada una pagina si falta `pages_manage_posts` o si la pagina no fue seleccionada en permisos granulares.
- Si Meta devuelve menos paginas de las esperadas, la UI debe explicar que el usuario puede revisar permisos granulares en Facebook/Business Integrations y reconectar.
- Antes de operar con clientes externos, completar App Review y Business Verification cuando Meta lo exija para esos permisos.

Flujo manual de soporte:

1. Solo aparece si `requiresManualToken = true` y ambiente lo permite.
2. Llama `POST /auth/meta-token/support`.
3. Si el token es invalido, muestra error `El token de Meta no es valido.`
4. Si es valido:
   - API intenta convertirlo a long-lived token;
   - lista paginas;
   - obtiene page access token de cada pagina;
   - persiste estado;
   - devuelve paginas.

### Validaciones

- Token manual vacio: boton manual deshabilitado cuando el modo soporte este habilitado.
- Error de red: mostrar mensaje entendible con URL base de API.
- Token manual invalido: no continuar a paginas.
- Acceso Meta expirado en reconexion: conservar usuario en pantalla de reconexion.

## Pantalla T2 - Ayuda de conexion

### Formato

Bottom sheet:

- scrim oscuro;
- handle superior;
- titulo `Como conectar Facebook`;
- pasos en texto breve.

### Copy base

1. Toca conectar y abre Facebook.
2. Autoriza FBmaniaco y elige tus paginas.
3. Vuelve a la app cuando Facebook confirme el acceso.

Copy solo para soporte/desarrollo:

1. Abre el panel de desarrolladores de Meta.
2. Genera un token temporal con permisos de paginas activas.
3. Pegalo solo si soporte te lo pidio.

### Regla

No debe mostrar credenciales reales, capturas sensibles ni instrucciones que animen a guardar secretos en el codigo.

## Pantalla P1 - Seleccion de pagina

### Cuando aparece

- Autorizacion Meta valida, pero no hay negocio seleccionado.
- La autorizacion Meta tiene varias paginas.
- La autorizacion Meta es valida, pero algunas paginas no fueron concedidas por permisos granulares.
- El usuario abre configuracion y toca la pagina conectada para cambiar.

### Layout

- Titulo `Elige tu negocio`.
- Subtitulo: `Si solo hay una pagina, la seleccionaremos automaticamente.`
- Estado auxiliar si faltan paginas: `Si no ves una pagina, revisa que la hayas marcado al autorizar Facebook.`
- Grid/lista de tarjetas.
- Cada tarjeta:
  - imagen de portada si existe;
  - overlay oscuro;
  - nombre de pagina;
  - estilo seleccionado si ya era activa.

### Comportamiento

Al tocar pagina:

1. App llama `POST /meta/pages/select`.
2. API busca pagina en DB/cache reconstruible.
3. API valida que la pagina pertenece al workspace, fue concedida por Meta y tiene permisos suficientes para publicar.
4. Si no existe negocio para esa pagina, crea uno:
   - `name = pageName`;
   - `industry = category` o `Facebook Page`;
   - `timezone = America/Mexico_City`;
   - `tokenStatus = pageAccessTokenStatus` o estado del meta token;
   - `metadata.pageName = pageName`;
   - `autonomySettings` con defaults.
5. API selecciona pagina y negocio.
6. App guarda seleccion local.
7. Si es primera vez, puede pasar a bienvenida; si ya existe, home.

## Pantalla W1 - Bienvenida

### Cuando aparece

Despues de seleccionar pagina conectada por primera vez o cuando el flujo quiere confirmar que el negocio esta listo.

### Contenido

- Avatar/cover de pagina si existe.
- Titulo: `Hola, {nombre negocio}`.
- Subtexto: `Tu negocio esta conectado y listo.`
- CTA para empezar.

### Comportamiento

El CTA lleva a Home o crea lote inicial segun contexto.

## Reconexion Meta

### Disparadores

- Token status `expirado`.
- Meta devuelve error de token al programar/publicar.
- Dashboard produce alerta `facebook_token`.
- Scheduled post queda `pausada_por_token`.

### UX

Home muestra alerta:

- titulo con mensaje de token;
- accion `Reconectar`;
- texto: `Las publicaciones estan pausadas.`

La pantalla de reconexion muestra:

- card de alerta `Facebook desconectado`;
- copy `Las publicaciones programadas estan pausadas hasta que reconectes.`

### API

`POST /auth/meta/connect`

- Inicia o continua OAuth/Facebook Login/device login.
- Puede devolver `authorizationUrl` o `pendingDeviceLogin`.
- No recibe tokens manuales.

`POST /auth/meta/callback`

- Endpoint server-side para completar OAuth/callback.
- Recibe codigo/verificador segun flujo.
- Intercambia con Meta y guarda credenciales server-side.

`POST /auth/meta/refresh`

- Intenta refrescar credenciales tecnicas server-side.
- No requiere que el usuario pegue token.

`POST /auth/meta-token/support`

- Solo desarrollo/soporte.
- Deshabilitado en produccion salvo variable server-side explicita.

Al reconectar:

- valida la autorizacion o token tecnico recibido por Meta;
- refresca si puede;
- actualiza paginas;
- actualiza `MetaAuthorization`;
- actualiza scopes concedidos/rechazados y version Graph;
- marca paginas que dejaron de estar concedidas como `requiere_reconexion` o `error_permiso`;
- actualiza status de negocio;
- elimina alerta de token en dashboard.

## Datos locales del celular

La app guarda seleccion basica en storage local:

- business seleccionado;
- pagina seleccionada;
- estado de navegacion basico.

No debe guardar:

- token largo;
- page access token;
- secretos de proveedores.

## Endpoints del modulo

`GET /auth/bootstrap-status`

- Proposito: decidir pantalla inicial.
- Error esperado: 500 solo si API/DB no levantan.

`POST /auth/meta/connect`

- Body: vacio o `{ flow: "oauth" | "facebook_login" | "device_login" }`.
- Respuesta: status bootstrap, paginas si ya quedo autorizado o `pendingDeviceLogin`/`authorizationUrl`.

`POST /auth/meta/callback`

- Body: `{ code, state }` o payload equivalente segun flujo.
- Respuesta: token procesado server-side, status bootstrap, paginas.

`POST /auth/meta/refresh`

- Body vacio.
- Respuesta: status bootstrap, paginas y alertas.

`POST /auth/meta-token/support`

- Body: `{ token, source }`, solo para soporte/desarrollo.
- Source: `manual_support`.
- Respuesta: token procesado, status bootstrap, paginas.

`POST /auth/logout`

- Cierra la sesion local de FBmaniaco y revoca/limpia la sesion server-side si existe.
- La app debe limpiar sesion local.
- No desconecta Meta ni revoca permisos de pagina; esa accion pertenece a Configuracion como `Desconectar Facebook`.

`GET /meta/pages`

- Lista paginas sin exponer page access token.

`POST /meta/pages/select`

- Body: `{ pageId }`.
- Respuesta: business y status.

`GET /me`

- Devuelve usuario local `owner` y sesion local.

## Estados de error

- Token manual invalido: error visible bajo input de soporte.
- Device login pendiente: mostrar codigo y no bloquear pantalla.
- API unreachable: explicar que no se pudo conectar con la API.
- Acceso Meta expirado: no permitir programar nuevas publicaciones hasta reconectar.
- Permisos faltantes: mostrar permisos faltantes y boton `Reconectar Facebook`.
- Pagina no concedida: explicar que esa pagina no fue seleccionada en Facebook y permitir reconectar.
- App Review pendiente: bloquear publicacion para clientes externos y mostrar mensaje interno de configuracion si el workspace no es tester/dev.

## Interfaz con otros modulos

- Publica para Home: `facebookTokenStatus`, negocio activo, alertas de reconexion y `nextStep`.
- Publica para Configuracion: pagina activa, nombre de negocio, categoria, token status y accion de reconectar/cambiar pagina.
- Publica para Calendario: token status sanitizado; si falla Meta, scheduled posts pasan a `pausada_por_token`.
- Publica para Lotes: `businessId`, `facebookPageId`, timezone y permisos suficientes para publicar despues.
- Consume de API/datos: `MetaAuthorization`, `MetaPage`, `Business`, `FacebookTokenStatus`, `AppErrorResponse`.
- Registra eventos: `meta_autorizacion_actualizada`, `meta_scopes_actualizados`, `pagina_seleccionada`, `negocio_creado` y `reconexion_requerida`.
- Invalida/refresca: Home, Calendario y Configuracion despues de conectar, reconectar o seleccionar pagina.

Regla de eficiencia:

- Despues de `POST /meta/pages/select`, la API debe devolver negocio activo y `nextStep`. La app no debe pedir tres endpoints solo para entrar a Home.


