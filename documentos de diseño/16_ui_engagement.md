# Modulo transversal - IU practica y engagement etico
### Como debe sentirse FBmaniaco en la mano

Fecha de revision: 2026-05-08

## Veredicto

La IU de FBmaniaco debe parecerse mas a una herramienta de produccion diaria que a una red social. Debe ser rapida, visual, clara y agradable de repetir. El objetivo no es que el usuario pierda tiempo dentro de la app; el objetivo es que complete la accion importante con poca energia mental y quiera volver porque sintio avance real.

Este documento es la fuente de verdad para patrones de IU, engagement etico, componentes base y microcopy transversal. `12_ux_qa.md` solo valida que estos patrones se cumplan. Los documentos de pantalla (`03_home.md`, `04_lotes.md`, `05_calendario.md`, `06_configuracion.md`) solo deben describir especializaciones de su flujo.

La app debe ser "pegajosa" por utilidad:

- El usuario abre y sabe que hacer.
- Ve progreso de su negocio.
- Tiene una accion principal clara.
- Recibe recompensas visuales por completar trabajo real.
- Puede corregir errores sin miedo.
- Siente que cada sesion produjo contenido listo o mejoro su calendario.

## Fuentes y casos usados

- NN/g 10 Usability Heuristics: estado visible, lenguaje familiar, control/undo, prevencion de errores y diseno minimalista. Fuente: https://www.nngroup.com/articles/ten-usability-heuristics/
- Material Design Navigation Bar: navegacion inferior para 3 a 5 destinos principales. Fuente: https://m3.material.io/components/navigation-bar/overview
- Material Design Progress Indicators: progreso visible para operaciones. Fuente: https://m3.material.io/components/progress-indicators/overview
- Android Predictive Back: navegacion back predecible y consistente en Android moderno. Fuente: https://developer.android.com/guide/navigation/predictive-back-gesture
- Baymard UX research: reducir friccion en formularios y acciones repetidas; no obligar confirmaciones innecesarias. Fuente: https://baymard.com/learn/ecommerce-ux-best-practices
- Canva/Fleet Feet: plantillas y brand kit ahorraron 120 horas anuales y redujeron trabajo de video/motion de 3 horas a 15 minutos. Fuente: https://www.canva.com/case-studies/fleet-feet/
- Canva/Aegis Living: brand kit, plantillas y aprobaciones reducen costo y retrabajo en marketing. Fuente: https://www.canva.com/case-studies/aegis-living/
- Duolingo Method: sesiones cortas, feedback inmediato, progresion visible y habitos. Fuente: https://duolingo-papers.s3.amazonaws.com/reports/duolingo-method-whitepaper.pdf
- Slack PLG case: onboarding, tono humano, empty states y experimentar alrededor de momentos de valor real. Fuente: https://www.ideaplan.io/case-studies/slack-product-led-growth

## Principios de IU

1. Una pantalla, una intencion.
   Cada pantalla debe responder: que esta pasando, que puedo hacer ahora y que pasa despues.

2. Accion principal siempre cerca del pulgar.
   En Android movil, el footer fijo o bottom sheet debe contener la accion de avance. Las acciones secundarias no compiten visualmente.

3. Home es hoy, no archivo.
   Home debe mostrar estado actual y siguiente accion, no listas completas.

4. Imagen primero cuando se decide contenido.
   En aprobacion, calendario detalle y lote, la imagen manda. El texto complementa; no tapa la imagen.

5. Progreso visible en jobs.
   OpenAI, uploads, publicaciones y reintentos deben mostrar pasos y porcentajes aproximados, no spinners infinitos.

6. Recompensa por trabajo real.
   Celebrar cuando se programa una semana, se arregla un error, se completa un lote o se mantiene consistencia de publicacion.

7. Sin miedo a equivocarse.
   Rechazar variante, editar caption, cancelar antes de Meta y volver a aprobacion deben sentirse seguros.

8. Personalidad breve.
   El tono puede ser humano y alentador, pero nunca infantil ni burlon. La app habla como asistente de marketing local, no como juego.

9. Cero patrones oscuros.
   No usar culpa, urgencia falsa, notificaciones agresivas, scroll infinito, botones escondidos, confirmshaming ni obstaculos para cancelar.

## Loop central de engagement

El loop que debe repetirse:

```text
Foto real del negocio
  -> IA entiende y propone
  -> usuario aprueba rapido
  -> calendario se llena
  -> app muestra progreso semanal
  -> usuario vuelve con nuevas fotos
```

Este loop es mejor que feeds infinitos porque produce valor externo: publicaciones reales. La app debe optimizar el tiempo hasta el primer post programado.

Metricas de IU:

- Tiempo hasta primer lote creado.
- Tiempo hasta primera variante aprobada.
- Tiempo hasta primera semana programada.
- Porcentaje de variantes aprobadas sin editar.
- Porcentaje de jobs que el usuario entiende mientras esperan.
- Reintentos Meta resueltos sin soporte.
- Retorno semanal con nueva foto o nuevo lote.

## Navegacion recomendada

Usar barra inferior con 4 destinos principales:

| Tab | Funcion | Regla |
| --- | --- | --- |
| Hoy | Dashboard, alertas, siguiente accion. | Tab inicial. |
| Crear | Lotes, upload, generacion y aprobacion. | Acceso directo al loop central. |
| Calendario | Posts programados, fallas, reintentos. | Estado de publicacion. |
| Negocio | Pagina, SEO, estilos, autonomia, conexion Meta. | Configuracion y salud. |

No usar mas de 5 tabs. Reportes pueden vivir dentro de Hoy o Negocio hasta que sean uso frecuente.

Back/volver:

- Respetar back de Android.
- Si hay cambios sin guardar, mostrar hoja de confirmacion breve.
- Si una accion ya llego a Meta, explicar limite real; no prometer undo falso.

## Home

Home debe ser una pantalla de accion, no un resumen decorativo.

Orden recomendado:

1. Salud del negocio:
   - pagina activa;
   - token status;
   - publicaciones pendientes/fallidas;
   - semana cubierta.
2. Siguiente mejor accion:
   - `Crear lote`;
   - `Continuar aprobacion`;
   - `Resolver token`;
   - `Reintentar post`;
   - `Ver calendario`.
3. Progreso semanal:
   - barra de publicaciones programadas vs objetivo;
   - copy tipo `3 de 7 publicaciones listas esta semana`.
4. Lote activo:
   - solo si requiere accion.
5. Mini calendario:
   - proximos 7 dias, no lista completa.

Microcopy:

- Bueno: `Te falta 1 post para cubrir esta semana.`
- Bueno: `Hay 4 variantes listas para aprobar.`
- Malo: `No pierdas tu racha o tu negocio desaparecera.`
- Malo: `Tu pagina esta muriendo.`

## Crear / Lotes

El flujo debe sentirse como una bandeja de aprobacion rapida.

Reglas:

- Upload debe abrir con una zona grande y un boton evidente.
- Despues de subir, la app debe mostrar que la IA esta analizando cada foto.
- En review, mostrar chips de lo que la IA entendio: producto, fondo, calidad, riesgos.
- En variantes, mostrar estimacion de costo/tiempo antes de generar.
- En generacion, mostrar pasos: `Analizando`, `Creando estilos`, `Generando imagen`, `Escribiendo caption`, `Guardando`.
- En aprobacion, usar swipe como acelerador, pero siempre con botones visibles `Aprobar`, `Rechazar`, `Editar caption`.
- Despues de cada aprobacion, mostrar progreso tipo `5 de 12 revisadas`.

Patron tipo Canva:

- El usuario nunca empieza desde lienzo blanco.
- La app propone estilos y variantes.
- El usuario elige, ajusta y aprueba.
- Configuracion de marca/SEO reduce trabajo futuro.

## Calendario

El calendario debe dar paz, no carga.

Reglas:

- Mostrar semana primero.
- Marcar dias cubiertos, dias vacios y posts con error.
- Cada post tiene status visible: programado, publicado, fallido, pausado por token.
- Acciones principales por post:
  - editar fecha/hora;
  - reintentar;
  - cancelar si no llego a Meta;
  - ver resultado si ya publico.
- La app debe separar claramente `programado localmente` de `confirmado por Meta` si existe esa diferencia.

Engagement sano:

- Celebrar semana cubierta.
- Sugerir crear mas si hay huecos.
- No usar culpa por dias vacios.

## Negocio / Configuracion

Configuracion debe sentirse como "hacer que la app aprenda mi negocio".

Secciones:

- Pagina conectada.
- SEO local.
- Tipos de contenido.
- Estilos visuales.
- Autonomia.
- Salud de cuenta.

Reglas:

- Cada cambio debe decir a que afecta:
  - `Afecta nuevas variantes`;
  - `No cambia posts ya programados`;
  - `Puede mejorar captions futuros`.
- Usar previews pequeñas antes de guardar estilos.
- No esconder reconexion Meta dentro de menus profundos.
- No pedir tokens manuales como flujo normal. La accion visible debe ser `Conectar con Facebook` o `Reconectar Facebook`, usando autorizacion oficial.

## Reportes y rachas

Usar "consistencia" en vez de "adiccion".

Elementos permitidos:

- Semana cubierta.
- Dias con post programado.
- Posts publicados sin falla.
- Mejores captions o estilos.
- Sugerencia de siguiente lote.
- Celebracion breve al completar semana.

Elementos prohibidos:

- Rachas con perdida dolorosa.
- Mensajes de culpa.
- Rankings contra otros negocios.
- Notificaciones fuera de horario configurable.
- Recompensas que empujen a publicar contenido malo.

## Notificaciones

Solo deben existir si ahorran problemas.

Permitidas:

- `Tu lote termino de generar.`
- `Hay publicaciones pausadas por reconexion.`
- `Tu semana tiene 2 huecos.`
- `Un post fallo y necesita reintento.`

No permitidas:

- urgencia falsa;
- multiples recordatorios diarios por defecto;
- notificaciones de vanidad sin accion;
- mensajes que castiguen al usuario.

## Componentes base

| Componente | Uso | Regla |
| --- | --- | --- |
| Bottom navigation | 4 destinos principales | Siempre visible despues de onboarding. |
| Action footer | Accion primaria por pantalla | Fijo, grande, con estado loading/disabled. |
| Job progress card | IA/publicacion/reintentos | Mostrar paso actual, avance y salida segura. |
| Alert card | Token, post fallido, sistema | Una accion principal clara. |
| Swipe approval card | Revisar variante | Swipe + botones visibles. Imagen completa. |
| Week coverage bar | Home/calendario | Mostrar progreso hacia objetivo semanal. |
| Empty state util | Sin lote, sin calendario, sin estilos | Dar accion concreta, no texto decorativo. |
| Toast/snackbar | Confirmacion liviana | No usar para errores criticos. |
| Bottom sheet | Confirmar/cambiar detalle | Debe poder cerrarse y respetar back. |

## Copy de alto rendimiento

Patron:

- Estado: que pasa.
- Valor: por que importa.
- Accion: que toca hacer.

Ejemplos:

| Situacion | Copy recomendado |
| --- | --- |
| Sin lote | `Sube fotos reales y arma publicaciones para esta semana.` |
| Generando | `Estoy creando variantes distintas para que elijas rapido.` |
| Aprobacion | `Elige las mejores. Yo preparo el calendario despues.` |
| Semana cubierta | `Semana cubierta: tus posts ya estan listos.` |
| Acceso Meta vencido | `Facebook pidio reconexion. Tus publicaciones quedan pausadas hasta resolverlo.` |
| Post fallido | `Este post no salio. Puedes reintentarlo sin duplicarlo.` |
| SEO guardado | `Listo. Los nuevos captions usaran estas palabras.` |
| Conectar Facebook | `Autoriza tu pagina desde Facebook. No necesitas copiar tokens.` |

## Prohibiciones de IU

- No crear landing page dentro de la app.
- No usar scroll infinito.
- No ocultar cancelar, rechazar ni volver.
- No mostrar dashboards densos antes de que haya datos.
- No usar skeletons largos sin progreso real.
- No pedir decisiones que la IA puede proponer con seguridad.
- No mostrar errores tecnicos crudos.
- No mostrar tokens, IDs largos ni payloads.
- No usar modales consecutivos.
- No bloquear la app mientras un job corre; mostrar progreso y permitir salir.

## Prioridad de implementacion

1. Bottom nav de 4 tabs.
2. Home con siguiente mejor accion y progreso semanal.
3. Job progress card reusable.
4. Aprobacion con swipe + botones visibles.
5. Calendario semanal con estados claros.
6. Empty states con accion.
7. Microcopy de errores y reconexion.
8. Celebraciones breves por semana cubierta/lote completado.
9. Notificaciones utiles y configurables.
10. Reporte semanal simple.

## Prueba de calidad

Una pantalla pasa si:

- El usuario puede decir en 3 segundos que debe hacer.
- La accion primaria esta visible sin buscar.
- El estado del sistema se entiende sin abrir otra pantalla.
- Si hay error, existe una salida clara.
- Si hay job, se puede salir y volver sin perder progreso.
- No hay texto que manipule, culpe o asuste.
- No hay elementos visuales que compitan con la imagen cuando se decide contenido.
