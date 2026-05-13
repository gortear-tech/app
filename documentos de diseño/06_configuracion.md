# Modulo 5 - Configuracion, SEO y estilos visuales
### Ajustes por negocio/pagina

## Principio de diseno

Configuracion debe permitir modificar la estrategia del negocio sin tocar codigo. Es una pantalla operativa, no un panel tecnico.

Debe cubrir:

- negocio conectado;
- estado de Facebook;
- autonomia;
- catalogo de estilos;
- tipos de contenido;
- SEO Facebook;
- cuenta local.

## Pantalla S1 - Configuracion principal

### Header

- boton volver;
- titulo `Configuracion`;
- subtitulo `Negocio, autonomia, contenido, estilos y cuenta`.

### Secciones

1. Negocio.
2. Autonomia.
3. Estilos visuales.
4. Contenido.
5. SEO Facebook.
6. Cuenta.

## Seccion Negocio

Muestra:

- pagina de Facebook conectada;
- status de token;
- industria;
- zona horaria.

La fila de pagina es interactiva:

- si token esta `expirado` o `requiere_reconexion`, abre reconexion;
- si token esta valido, abre seleccion de paginas.

Chip de estado:

- verde si `valido` o `por_vencer`;
- danger si `expirado` o `requiere_reconexion`;
- muted para otros estados.

## Seccion Autonomia

Acciones:

- `STYLE_ASSIGNMENT`: Asignar estilo a tus fotos.
- `VARIANT_COUNT`: Decidir cuantas variantes generar.
- `SCHEDULING`: Elegir horarios de publicacion.
- `CAPTION_GENERATION`: Generar captions.
- `FACEBOOK_PUBLISH`: Publicar en Facebook.

Cada accion se muestra con:

- etiqueta;
- pill:
  - `Autonomo`;
  - `Requiere confirmacion`.
- boton `Resetear` si ya es autonoma.

### Umbrales

Si el threshold/score supera el limite, la UI marca autonomo. En la implementacion actual el texto depende de `getAutonomyTone`.

### Reset

Al resetear:

- app llama `PATCH /businesses/:businessId`;
- body incluye `autonomySettings` actualizado;
- refresca negocios.

### Opt-in de publicacion autonoma

`FACEBOOK_PUBLISH` es especial:

- No puede pasar a autonomo solo por aprobaciones repetidas.
- Requiere interruptor explicito `Permitir publicar automaticamente`.
- Antes de activarlo, la UI debe mostrar resumen de condiciones: pagina conectada, presupuesto activo, horarios permitidos, reconexion sana y posibilidad de pausar.
- Debe existir boton `Pausar publicacion automatica` siempre visible en Configuracion.
- Si hay acceso Meta vencido, post incierto, costo fuera de presupuesto, persona visible o promocion/precio visible, la autonomia de publicacion se pausa automaticamente.

## Seccion Estilos visuales

La configuracion principal no edita estilos inline. Muestra:

- texto explicativo;
- fila `Abrir editor de estilos`;
- contador de estilos guardados.

Al tocar, navega a pantalla `styles`.

## Pantalla S2 - Editor de estilos

### Header

- etiqueta `CATALOGO DE ESTILOS`;
- titulo `Estilos visuales`;
- subtitulo `Edita, borra o agrega estilos manualmente`.

### Biblioteca

Card:

- numero de estilos guardados;
- boton `Nuevo estilo`;
- lista de style cards.

Cada style card:

- emoji segun intensidad;
- nombre;
- descripcion;
- pill `Base` o `Personal`;
- prompt base;
- industrias recomendadas;
- tipos de foto;
- acciones:
  - modificar;
  - eliminar.

## Modal crear/editar estilo

Campos:

- Nombre.
- Descripcion.
- Prompt base.
- Industria sugerida.
- Tipos de foto.
- Intensidad:
  - ligera;
  - media;
  - fuerte.
- Divulgacion IA:
  - Si;
  - No.
- Restricciones.

Validacion:

- nombre requerido;
- descripcion requerida;
- prompt requerido.

Formato de listas:

- aceptar comas;
- aceptar saltos de linea;
- normalizar quitando vacios.

Endpoints:

- `GET /styles`
- `POST /styles`
- `PATCH /styles/:styleId`
- `DELETE /styles/:styleId`

## Modelo de estilo visual

Campos:

- `id`
- `name`
- `description`
- `promptTemplate`
- `recommendedIndustries`
- `recommendedPhotoTypes`
- `intensity`
- `aiDisclosureRequired`
- `restrictions`
- `isCustom`
- `createdAt`
- `updatedAt`

## Reglas del catalogo

- Los estilos base vienen de `INITIAL_VISUAL_STYLES`.
- Los estilos creados por usuario tienen `isCustom = true`.
- Eliminar estilo no borra variantes ya creadas.
- Un estilo eliminado deja de aparecer en nuevas asignaciones.
- Si no hay estilos, generar variantes debe fallar con mensaje claro.

## Estilos base actuales

El catalogo debe separar estilos por nivel de riesgo comercial:

- `realista_seguro`: mejora producto, luz, fondo y composicion sin transformar el negocio de forma extravagante. Debe ser el default.
- `editorial_comercial`: look mas aspiracional, fondos producidos, mayor contraste y direccion de campana.
- `experimental`: estilos fantasiosos, cinematicos o humoristicos. Solo se usan si el negocio los habilita o si la IA tiene alta confianza de que encajan.

Regla:

- En nuevos negocios, la asignacion automatica debe priorizar `realista_seguro` y `editorial_comercial`.
- Los estilos `experimental` no deben usarse para personas, logos, precios, menus con texto visible ni marcas sensibles salvo aprobacion explicita.

El catalogo puede incluir estilos con nombres como:

- Callejon cyberpunk.
- Terraza al atardecer.
- Exhibicion espacial.
- Calle japonesa nocturna.
- Ambiente volcanico.
- Estudio marmol premium.
- Bosque fantastico.
- Retro diner americano.
- Refugio nevado.
- Escena submarina.
- Caricatura con fondo suave.
- Lluvia en ventana.
- Cabana de montana.
- Fondo abstracto premium.
- Restaurante desenfocado.
- Oceano surreal.
- Escena anime gastronomica.
- Spotlight de menu oscuro.
- Picnic natural desenfocado.
- Criatura gigante comica.

Cada uno define industria, tipos de foto, intensidad y restricciones.

## Uso de estilos en el flujo actual

Regla principal:

- Los estilos se usan al generar variantes, no al analizar fotos.

Proceso:

1. Foto se analiza.
2. En generacion, por cada variante se calcula estilo.
3. El estilo queda guardado en la variante.
4. La UI muestra estilo en caption/aprobacion/calendario.

Esto reemplaza el modelo viejo de "estilo asignado por foto".

## Seccion Contenido

Permite agregar tipos personalizados de publicaciones.

Ejemplos:

- promocion;
- producto nuevo;
- combo;
- evento;
- testimonio;
- menu;
- temporada.

Datos:

- se guardan en `business.metadata.contentTypes`.

UI:

- lista de chips/filas existentes;
- tocar elimina;
- input `Nuevo tipo, ej. Promocion`;
- boton agregar.

Normalizacion:

- trim;
- colapsar espacios;
- evitar duplicados.

## Seccion SEO Facebook

Proposito:

Guardar keywords locales por pagina/negocio para que cada caption se cree pensando en busqueda y descubrimiento dentro de Facebook.

Datos:

- `business.metadata.facebookSeoKeywords`: arreglo de strings.
- `business.metadata.facebookSeoContext`: texto opcional para futuro.

UI:

- titulo `SEO Facebook`.
- subtitulo `Keywords locales para los captions`.
- texto: `Estas palabras se mandan a OpenAI cuando genera el texto, optimizadas para busqueda local dentro de Facebook.`
- lista de keywords.
- tocar keyword elimina.
- input placeholder:
  `sushi Tapalpa, sushi en Tapalpa`
- boton `Agregar`.

Normalizacion:

- separar por coma;
- trim;
- eliminar vacios;
- evitar duplicados;
- conservar frase natural.

Uso en caption:

- OpenAI recibe keywords.
- Debe integrarlas sin keyword stuffing.
- Debe pensar en intencion local.
- Debe usar hashtags solo si aportan valor.

## Seccion Cuenta

MVP:

- boton `Cerrar sesion`.

Comportamiento:

- limpia sesion local del celular;
- no revoca permisos Meta por defecto;
- si el usuario elige `Desconectar Facebook`, backend revoca o invalida credenciales Meta server-side cuando Meta lo permita y pausa publicaciones pendientes.

## Endpoints del modulo

`GET /businesses/:businessId`

- obtiene detalle con metadata/autonomia.

`PATCH /businesses/:businessId`

- actualiza:
  - name;
  - industry;
  - timezone;
  - autonomySettings;
  - metadata.

`GET /styles`

- lista catalogo.

`POST /styles`

- crea estilo custom.

`PATCH /styles/:styleId`

- modifica estilo.

`DELETE /styles/:styleId`

- elimina estilo.

## Interfaz con otros modulos

- Publica para Lotes: SEO, tono, tipos de contenido, autonomia y estilos disponibles para nuevas generaciones.
- Publica para servicios internos de IA: parametros de autonomia, preferencias de estilo y contexto SEO por negocio.
- Publica para Home: nombre, industria, timezone y estado de cuenta visibles.
- Consume de Meta/onboarding: pagina activa, token status y accion de reconectar/cambiar pagina.
- Consume de API/datos: `Business`, `BusinessMetadata`, `VisualStyle` y `AutonomyState`.
- Registra eventos: `negocio_actualizado`, `seo_actualizado`, `autonomia_actualizada`, `estilo_creado`, `estilo_actualizado`, `estilo_eliminado`.
- Invalida/refresca: Home despues de cambiar nombre/timezone/token; Lotes solo para generaciones futuras.

Regla de eficiencia:

- Cambios de SEO y estilos no deben recalcular variantes ya generadas ni reescribir captions existentes automaticamente. La respuesta de guardado debe confirmar que aplicara a nuevos lotes.

## Reglas de calidad

- No mostrar controles que contradigan el modelo actual.
- No permitir cambiar estilo de foto.
- El SEO debe estar por negocio/pagina, no global para toda la app.
- Las keywords deben afectar nuevos captions, no reescribir captions existentes automaticamente.
- Los estilos modificados no deben alterar variantes ya publicadas.


