# Modulo 3 - Lotes, fotos, variantes y aprobacion
### Flujo central de creacion de publicaciones

## Principio de diseno

El flujo debe sentirse como una linea de produccion simple:

1. Subir fotos.
2. Revisar analisis.
3. Elegir cantidad.
4. Generar variantes.
5. Aprobar/rechazar.
6. Programar.

El usuario no debe decidir estilo por foto. La app decide estilo por variante para que cada resultado sea distinto.

La IU del lote debe parecerse a una bandeja de aprobacion rapida: imagen grande, decision clara, progreso visible y salida segura. La referencia de engagement etico vive en `16_ui_engagement.md`.

## Estados del flujo movil

`BatchFlowStep`:

- `upload`
- `review`
- `detail`
- `variants`
- `generating`
- `swipe`
- `summary`

La funcion `getBatchFlowStep` decide el paso segun status y contenido:

- sin lote o sin fotos: `upload`;
- fotos validadas sin variantes: `review` o `variants`;
- status `generando`: `generating`;
- variantes `generada`: `swipe`;
- variantes aprobadas/rechazadas: `summary`.

## Pantalla B1 - Upload

### Layout

- Header:
  - paso 1;
  - titulo `Subir fotos`;
  - subtitulo `Toca para elegir fotos y empezar el analisis`.
- Area grande de upload:
  - icono;
  - texto `Toca para elegir fotos`;
  - formatos permitidos.
- Grid preview de fotos seleccionadas.
- Badge para quitar foto.
- contador de fotos seleccionadas.
- footer fijo con `Analizar fotos`.

Empty state:

- texto principal `Sube fotos reales y arma publicaciones para esta semana`;
- texto secundario `La IA las analizara y te propondra variantes listas para aprobar`;
- accion primaria `Elegir fotos`;
- no mostrar tutorial largo antes de la primera foto.

### Reglas

- Maximo visual esperado: 10 fotos.
- El boton `Analizar fotos` se deshabilita si no hay fotos o no hay batchId.
- Cada foto debe subirse como archivo binario mediante signed URL antes de completar subida.

## Upload tecnico

Por cada foto:

1. App llama:
   `POST /businesses/:businessId/batches/:batchId/photos/upload-intent`
2. API devuelve:
   - `uploadUrl`
   - `storageKey`
   - headers/campos requeridos;
   - vencimiento;
   - tamano y content type permitidos.
3. App sube el archivo binario directamente a Storage usando la URL firmada.
4. App manda:
   `POST /businesses/:businessId/batches/:batchId/photos/complete-upload`
   con:
   - `storageKey`
   - `originalFileName`
   - `contentType`
   - `fileSize`
   - `checksum` opcional.
5. API verifica que el objeto existe, pertenece al workspace/negocio/lote y cumple metadata.
6. API registra `UploadIntent` como completado y crea `Photo` + `MediaAsset` original privado.
7. API crea job `analyze_photo`.
8. Worker corrige orientacion, remueve metadata sensible y genera thumbnail/derivado de vision si aplica.
9. Worker analiza la imagen con OpenAI Vision usando URL firmada temporal o lectura server-side.
10. Foto queda `validada`.
11. Lote queda `pendiente_confirmacion`.

Regla:

- `imageDataUrl` solo puede existir como fallback de desarrollo/emergencia. No es la ruta productiva.
- Para archivos grandes o red inestable, usar upload resumable/TUS con token firmado.
- El archivo original nunca va a bucket publico.
- `complete-upload` debe rechazar MIME falso, tamano excedido, intent vencido o `storageKey` fuera del workspace/lote.

## Analisis de foto

La foto guarda:

- sujeto:
  - tipo;
  - descripcion;
  - si hay persona.
- composicion:
  - encuadre;
  - angulo;
  - tipo de fondo;
  - descripcion del fondo;
  - iluminacion.
- paleta:
  - colores dominantes;
  - temperatura;
  - saturacion;
  - contraste.
- elementos sensibles:
  - precio visible;
  - logo visible;
  - persona visible;
  - promocion visible;
  - texto visible;
  - notas.
- calidad:
  - nitidez;
  - exposicion;
  - ruido.
- mood:
  - temperatura;
  - keywords;
  - descripcion.
- summary.

La foto NO guarda estilo ni prompt de edicion.

En UI, el analisis debe mostrarse como chips faciles de reconocer:

- producto/persona/espacio;
- calidad;
- fondo;
- texto visible;
- riesgo o advertencia.

No mostrar JSON ni terminos tecnicos al usuario.

## Pantalla B2 - Review

### Layout

- Header `Fotos analizadas`.
- Card `REVISION RAPIDA`.
- Grid de thumbnails.
- Cada tile:
  - imagen original;
  - overlay;
  - etiqueta con tipo de sujeto humanizado.
- Footer: `Generar variantes`.

### Comportamiento

- Tocar una foto abre detalle.
- No existe long press para cambiar estilo.
- Si no hay fotos analizadas, mostrar texto vacio.

## Pantalla B3 - Detalle de foto

### Layout

- Hero con imagen original.
- Boton volver flotante.
- Seccion `ANALISIS IA`.
- Chips:
  - sujeto;
  - encuadre;
  - luz;
  - mood;
  - fondo;
  - calidad.
- Resumen de vision.

### Regla

No mostrar "estilo asignado" aqui. El estilo no existe todavia. Se decide durante la generacion de cada variante.

## Pantalla B4 - Cantidad de variantes

### Layout

- Header `Cuantas variantes?`
- Texto: versiones que se generaran de cada foto.
- Stepper circular:
  - menos;
  - numero;
  - mas.
- Total: `{fotos} x {variantesPorFoto}`.
- Card de ayuda.
- Footer: `Confirmar y generar`.

### Reglas

- Minimo 1 variante por foto.
- Maximo UI actual 5 variantes por foto.
- Al confirmar:
  1. API estima costo.
  2. API confirma costo.
  3. API crea jobs de generacion.

## Estimacion de costo

Endpoint:

`POST /businesses/:businessId/batches/:batchId/estimate-cost`

Regla profesional:

- El costo no debe depender de una constante fija hardcodeada.
- La API calcula usando una tabla server-side de precios por proveedor, modelo, tipo de operacion, tamano de imagen y margen configurado.
- La respuesta debe separar `estimatedProviderCostUsd`, `estimatedCustomerCostUsd`, `currency`, `priceVersion` y `assumptions`.
- La estimacion debe incluir limites restantes: fotos, variantes, publicaciones, credito incluido y presupuesto IA mensual.
- El cliente nunca envia ni decide el precio; solo confirma el presupuesto calculado por backend.
- Para desarrollo puede existir fallback `fotos x variantes x 0.35 USD`, pero debe estar marcado como `priceVersion = dev-static`.

Endpoint:

`POST /businesses/:businessId/batches/:batchId/confirm-cost`

Guarda:

- `estimatedProviderCostUsd`;
- `confirmedCostUsd`;
- `confirmedPriceVersion`;
- `confirmedCostBreakdown`;
- reserva en `usage_meters`/`cost_ledger` para cupo y presupuesto;
- status `confirmado`.

Reglas:

- Si la reserva excede plan, credito o presupuesto, `confirm-cost` responde error amable y no crea jobs.
- Si el usuario cambia cantidad de variantes despues de confirmar, se recalcula y reemplaza la reserva anterior.
- Si la generacion se cancela antes de llamar proveedor, se libera la reserva.

## Generacion de variantes

Endpoint:

`POST /businesses/:businessId/batches/:batchId/generate`

Body:

- `variantsPerPhoto`.

Respuesta:

- `created`;
- `available`;
- `blockedReason`.
- `jobId` si queda asincrono.

### Secuencia por variante

Para cada foto y para cada indice de variante:

1. Verificar que el lote no este cancelado/fallido/abandonado.
2. Crear o reclamar job `generate_variant` con `dedupeKey`.
3. Elegir direccion creativa por `photoIndex + variantIndex`.
4. Seleccionar estilo diverso para esa variante con `styleService`.
5. Construir generation plan con servicio interno de IA.
6. Crear/actualizar `VariantRecord` en status `generando`.
7. Persistir en DB.
8. Llamar proveedor de imagen desde worker.
9. Subir imagen generada a bucket privado y crear `MediaAsset generated`.
10. Al aprobar/programar, crear o copiar `MediaAsset publishable` con URL HTTPS accesible por Meta.
10. Generar caption con SEO y anticopia.
11. Guardar variante como `generada`.
12. Registrar evento `variante_generada`.
13. Marcar job `succeeded`.

Si falla:

- guardar caption con descripcion de error;
- status `fallida`;
- job `failed` con error sanitizado;
- persistir en DB.

## Direcciones creativas

El sistema rota seis direcciones base:

1. Hero shot premium.
   - Producto centrado.
   - Fondo limpio aspiracional.
   - Copy de beneficio directo.

2. Close-up de antojo.
   - Textura, frescura, brillo natural.
   - Copy sensorial.

3. Ocasion social.
   - Composicion para compartir.
   - Copy de momento de consumo.

4. Descubrimiento local.
   - Imagen clara para feed.
   - Copy con SEO local natural.

5. Contraste editorial.
   - Fondo dramatico.
   - Gancho de curiosidad/novedad.

6. Cotidiano premium.
   - Realismo mejorado.
   - Copy cercano y confiable.

## Asignacion de estilo por variante

Entrada:

- negocio;
- foto con analisis;
- lote;
- memoria;
- indice de variante;
- indice de foto.

Puntuacion:

- match con industria del negocio;
- match con texto SEO/pagina;
- match con tipo y descripcion de foto;
- intensidad ligera suma si hay elementos sensibles;
- intensidad fuerte resta si hay elementos sensibles;
- penalizacion muy fuerte si el estilo ya se uso en esa misma foto;
- penalizacion moderada si ya se uso en el lote;
- pequeno desempate determinista.

Salida:

- `AssignedStyle` con:
  - `styleId`;
  - `styleName`;
  - `intensity`;
  - `contrast`;
  - `saturation`;
  - `warmth`;
  - `sharpness`;
  - `lowConfidence`;
  - `manualOverride`.

## Prompt de imagen

Debe envolver el prompt final con reglas de Facebook:

- `Facebook feed square post image.`
- `Output aspect ratio: 1:1 square.`
- Mantener sujeto importante dentro del canvas.
- No cortar producto/persona/logo/texto.
- No agregar texto nuevo.
- Usar composicion centrada y limpia.
- Crear una variante lista para publicar.

Adicionalmente:

- `Variant: X/Y`.
- `Creative visual direction: ...`.
- `Make this variant visibly different from sibling variants...`.

## Caption

Entrada:

- prompt base;
- estilo;
- descripcion del sujeto;
- tono del negocio;
- keywords SEO;
- contexto SEO;
- direccion de copy;
- direccion visual;
- indice de variante;
- captions recientes a evitar.

Reglas:

- una o dos frases maximo;
- espanol natural;
- maximo dos hashtags;
- alternar inicio y cierre;
- no repetir frases genericas;
- integrar SEO sin forzar.

## Pantalla B5 - Generating

### Layout

- Header `Generando`.
- Job progress card, no spinner infinito.
- contador `{variantes generadas} / {total}`.
- barra de progreso.
- pasos visibles:
  - `Analizando fotos`;
  - `Creando estilos`;
  - `Generando imagen`;
  - `Escribiendo caption`;
  - `Guardando variantes`;
  - `Preparando aprobacion`.

### Comportamiento

- El usuario puede cancelar desde header si esta disponible.
- El usuario puede salir y volver; el job sigue recuperable por API.
- Si cancela, generacion tardia debe detener escritura al detectar status cerrado.

## Pantalla B6 - Swipe de aprobacion

### Layout

- Top bar:
  - indicador `F{foto} Â· V{variante} de {total}`;
  - boton deshacer si hay historial.
- Card principal animada:
  - imagen con `resizeMode=contain`;
  - no forzar cover;
  - tint verde/rojo durante swipe;
  - caption en card inferior.
- Botones:
  - rechazar;
  - editar caption;
  - aprobar.

### Reglas visuales

- La imagen generada se ve completa.
- No debe recortarse para llenar pantalla.
- Como las imagenes son cuadradas, ocupan bien la parte superior y dejan espacio al caption.
- Swipe es acelerador, no unico camino: los botones siempre deben ser visibles.
- Mostrar progreso `N de total revisadas`.
- Tras aprobar/rechazar, dar feedback inmediato y avanzar a la siguiente.
- `Deshacer` solo aplica antes de programar o antes de side effect irreversible.

### Caption editable

- Preview de hasta cuatro lineas.
- Toggle `Ver mas` / `Contraer`.
- Al expandir, TextInput multilinea.
- Cambios se guardan en draft local y se envian al confirmar decisiones.

## Aprobacion/Rechazo

Endpoints:

- `POST /businesses/:businessId/batches/:batchId/variants/:variantId/approve`
- `POST /businesses/:businessId/batches/:batchId/variants/:variantId/reject`
- `PATCH /businesses/:businessId/batches/:batchId/variants/:variantId/caption`

Efectos:

- aprobar: status `aprobada`, evento `variante_aprobada`, autonomia caption sube.
- rechazar: status `rechazada`, evento `variante_rechazada`, autonomia caption baja.
- editar caption: evento `caption_editado_por_usuario`.

## Pantalla B7 - Resumen

### Layout

- Header `Resumen y periodo`.
- Hero con numero de variantes aprobadas.
- Contador de rechazadas.
- Selector de periodo:
  - 7 dias;
  - 14 dias;
  - 30 dias.
- Card explicativa.
- Boton `Programar publicaciones`.
- Boton secundario `Volver a aprobacion` si el lote aun no llego a Meta.

## Reabrir aprobacion

Endpoint:

`POST /businesses/:businessId/batches/:batchId/variants/reopen-approval`

Regla:

- Solo si ninguna publicacion del lote llego a Meta.
- Si ya hay `facebookPostId` o post `publicada`, bloquear para evitar duplicados.

## Cancelacion de lote

Endpoint:

`POST /businesses/:businessId/batches/:batchId/cancel`

Efectos:

- batch `cancelado`;
- fotos `eliminada`;
- variantes no publicadas `eliminada`;
- scheduled posts no publicados `cancelada`;
- evento `batch_abandoned`;
- persistencia inmediata.

Guardas:

- upload, complete upload, estimate, confirm, generate, reopen, edit caption, approve, reject, calendar confirm: todos rechazan lote cerrado.

## Interfaz con otros modulos

- Consume de Home: `businessId`, `batchId` activo y accion de continuar/cancelar.
- Consume de Configuracion: SEO, tono, tipos de contenido, autonomia y catalogo de estilos vigentes.
- Consume de servicios internos de IA via API/worker: asignacion de estilo por variante, generation plan, riesgo, captions y prediccion.
- Consume de API/datos: estados de `Batch`, `Photo`, `Variant`, reglas de cierre y errores.
- Publica para Home: progreso del lote, conteos, estado activo y alertas de lote fallido/cancelado.
- Publica para Calendario: variantes aprobadas listas para `calendar/confirm`.
- Publica para IA/memoria: eventos de foto validada, variante generada, aprobada, rechazada y caption editado.
- Publica/consume jobs: `analyze_photo`, `generate_batch`, `generate_variant`.
- Invalida/refresca: Home tras upload/generacion/aprobacion/cancelacion; Calendario tras confirmar programacion.

Regla de eficiencia:

- Durante generacion, la app debe refrescar progreso de lote/job y variantes disponibles, no descargar todo el dashboard en cada tick.
- Cada mutacion de variante debe devolver la variante actualizada y el resumen del lote para evitar llamadas encadenadas.


