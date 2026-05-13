# Modulo 2 - Home y dashboard
### FBmaniaco Â· Pantalla principal de negocio

## Principio de diseno

Home debe responder tres preguntas en menos de tres segundos:

1. Que negocio estoy operando.
2. Hay algo urgente que atender.
3. Que accion sigue.

No debe ser una landing page. Es una consola operativa movil.

Home tambien debe funcionar como motor de retorno sano: el usuario vuelve porque ve progreso real de su calendario y una accion clara, no porque la app lo manipula. La referencia de IU vive en `16_ui_engagement.md`.

## Datos que consume

Endpoint:

`GET /businesses/:businessId/dashboard`

Respuesta:

- `business`
- `alerts`
- `activeBatch`
- `batches`
- `performance`
- `weeklyReport`

Tambien consume:

`GET /businesses/:businessId/scheduled-posts`

para pintar calendario mini.

## Layout general

Pantalla full height con:

- top bar;
- stack de alertas y lote activo;
- card de siguiente mejor accion;
- cobertura semanal;
- mini calendario;
- footer fijo con accion principal y refrescar.

En pantallas chicas:

- textos se reducen a una linea;
- algunos botones son iconicos;
- se limita numero de alertas visibles;
- la mini tarjeta calendario se compacta.

## Top bar

Elementos:

- boton volver;
- avatar de pagina si hay cover;
- marca pequena `FBmaniaco`;
- nombre de negocio;
- boton configuracion.

Reglas:

- nombre de negocio usa una sola linea;
- si falta cover, mostrar placeholder circular;
- configuracion siempre visible.

## Alertas

Tipos:

- `facebook_token`
- `post_failed`
- `batch_abandoned`
- `system`

### Alerta de token

Disparo:

- negocio con `tokenStatus` expirado o requiere reconexion;
- page token status expirado;
- Meta devuelve error de token.

Contenido:

- mensaje de alerta;
- accion `Reconectar`;
- cuerpo: `Las publicaciones estan pausadas.`

Accion:

- abre pantalla de reconexion.

### Alertas de post fallido

Disparo:

- publicaciones programadas con status `fallida` o `pausada_por_token`.

Contenido:

- mensaje;
- accion `Ver calendario`;
- cuerpo: `Hay publicaciones fallidas que requieren atencion.`

Accion:

- abre calendario.

### Regla de overflow

En pantalla compacta:

- mostrar solo una o dos alertas;
- si hay mas, mostrar `+N alertas mas`.

## Siguiente mejor accion

Home siempre debe calcular una accion principal:

| Prioridad | Condicion | Accion | Copy sugerido |
| --- | --- | --- | --- |
| 1 | Acceso Meta vencido o permisos Meta rotos | `Reconectar` | `Facebook pidio reconexion. Tus posts estan pausados.` |
| 2 | Post fallido o pausado | `Ver calendario` | `Hay publicaciones que necesitan atencion.` |
| 3 | Lote con variantes listas | `Continuar aprobacion` | `Tienes variantes listas para elegir.` |
| 4 | Semana con huecos | `Crear lote` | `Te faltan posts para cubrir la semana.` |
| 5 | Semana cubierta | `Ver calendario` | `Semana cubierta. Revisa lo que sigue.` |

Reglas:

- Mostrar solo una accion principal.
- Acciones secundarias pueden ir como texto/icono, nunca compitiendo.
- El copy debe ser especifico, medible y sin culpa.

## Cobertura semanal

Home debe mostrar una barra compacta:

- objetivo semanal;
- publicaciones programadas;
- publicaciones publicadas;
- huecos restantes;
- errores que bloquean cobertura.

Ejemplo:

`3 de 7 publicaciones listas esta semana`

Reglas:

- Celebrar semana cubierta con una animacion breve.
- No usar rachas con perdida dolorosa.
- Si hay huecos, sugerir crear lote sin alarmismo.

## Performance visible

Home puede mostrar una tarjeta breve de aprendizaje, pero solo si el backend devuelve confianza suficiente.

Contenido permitido:

- posts publicados esta semana;
- publicaciones fallidas o pausadas;
- cobertura semanal;
- una recomendacion de siguiente accion;
- un insight simple con `confidence`.

Reglas:

- Si `sampleSize < 20`, no mostrar "mejor estilo" ni "mejor horario"; mostrar progreso operativo.
- Diferenciar "segun tus acciones en FBmaniaco" de "segun metricas de Meta".
- No mostrar views/engagement si la recoleccion esta `unavailable`, `deprecated` o sin permisos.
- Si no hay datos suficientes, el copy debe decir `Aun estoy juntando datos para recomendar con mas seguridad.`
- Home no debe mostrar tablas de analytics; eso vive en Reporte/Negocio.

## Lote activo

Un lote activo es cualquier lote del negocio cuyo status no sea:

- `completado`
- `cancelado`
- `fallido`
- `abandonado`

La card muestra:

- etiqueta `EN PROCESO`;
- titulo `Lote activo`;
- narrativa segun estado;
- numero de fotos;
- numero de variantes;
- barra de progreso;
- paso actual;
- botones continuar y cancelar.

## Narrativas por estado

- `pending_upload`: esperando fotos.
- `pendiente_confirmacion`: fotos analizadas; falta elegir variantes.
- `confirmado`: costo confirmado; listo para generar.
- `generando`: IA trabajando.
- `generado_parcial`: hay variantes listas para aprobacion o programacion.
- `completado`: lote cerrado.
- `fallido`: no se pudo completar.
- `cancelado`: lote cancelado.
- `abandonado`: lote abandonado.

## Progreso por estado

Conceptual:

- upload: 10-20%.
- fotos analizadas: 35-40%.
- costo confirmado: 50%.
- generando: 70%.
- variantes generadas: 85%.
- completado: 100%.

La UI no debe vender exactitud matematica; solo orienta al usuario.

## Estado sin lote activo

Card central:

- icono de camara.
- titulo `No hay nada aqui todavia`.
- copy `Sube tus fotos para empezar.`

Accion principal:

- `Subir fotos nuevas`.

## Mini calendario

La mini tarjeta muestra:

- titulo `Calendario`;
- mes actual;
- grid mensual;
- puntos por dia para posts;
- maximo 3 puntos visibles por dia.

Tocar la tarjeta abre calendario completo.

## Footer fijo

Botones:

- primario:
  - si no hay lote: `Subir fotos nuevas`;
  - si lote activo sin fotos: `Subir fotos`;
  - si lote activo con fotos: `Continuar lote`;
  - en pantalla minima puede ser solo icono.
- secundario: `Actualizar` o icono refresh.

## Acciones de Home

`Continuar lote`

- Si recibe batchId, abre ese lote.
- Si no hay batchId pero hay activeBatch, abre activeBatch.
- Si no hay lote, crea uno y abre pantalla de upload.

`Cancelar lote`

- Abre modal de confirmacion.
- Al confirmar llama `POST /businesses/:businessId/batches/:batchId/cancel`.
- Limpia solo cache local descartable del lote.
- Refresca dashboard.

`Actualizar`

- Vuelve a pedir dashboard, scheduled posts y business detail.
- Si hay jobs activos, refresca tambien progreso resumido.

## Cancelacion desde Home

Modal:

- titulo `Cancelar lote`.
- texto explicativo: se perderan fotos/variantes no publicadas.
- boton mantener/cerrar.
- boton peligro confirmar.

Regla:

- No permitir cancelar si lote esta cerrado.
- Si ya hay posts publicados, no revertirlos.
- Al cancelar, fotos pasan a `eliminada`, variantes no publicadas a `eliminada`, posts no publicados a `cancelada`.

## Interfaz con modulos

- Consume de Meta/onboarding: token status, negocio activo y alertas de reconexion.
- Consume de Lotes: `activeBatch`, resumen de progreso y acciones `continuar`/`cancelar`.
- Consume de Calendario: scheduled posts resumidos para mini calendario y alertas de fallas.
- Consume de Jobs: progreso de generacion, analisis y publicacion cuando existan trabajos activos.
- Consume de Configuracion: nombre, industria, timezone y estado visual del negocio.
- Publica acciones: crear lote, abrir lote, cancelar lote, abrir calendario, abrir configuracion y reconectar.
- Registra eventos indirectos mediante API: `batch_cancelado` cuando cancela y `alerta_resuelta` si una accion corrige token/post.
- Invalida/refresca: lote despues de cancelar, calendario despues de cambios de posts, configuracion despues de cambio de negocio.

Regla de eficiencia:

- Home debe preferir `GET /businesses/:businessId/dashboard` como endpoint agregado. Solo pide detalles separados cuando el usuario abre una pantalla concreta.

## Reglas de calidad

- Home nunca debe mostrar lotes cancelados como trabajables.
- Si el dashboard devuelve lote cerrado como activo, la app debe tratarlo como bug.
- Si no hay conexion a API, mostrar error global y mantener pantalla.
- El usuario no debe perder seleccion de negocio al refrescar.


