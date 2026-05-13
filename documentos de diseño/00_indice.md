# FBmaniaco - documentos de diseno

Fecha de corte: 2026-05-08
Fuente revisada: repositorio local `C:\Users\Gabriel\Desktop\FB maniaco`

Esta carpeta documenta FBmaniaco con suficiente detalle funcional y tecnico para reconstruir la app desde cero. No contiene secretos, tokens ni credenciales. Los documentos de Tapalpadamus se usaron solo como referencia de nivel de detalle y organizacion; no se modificaron.

## Orden recomendado de lectura

1. `01_base.md`
   Documento maestro: vision, arquitectura, entidades, ciclo diario, stack, reglas generales y mapa completo del producto.

2. `02_meta.md`
   Conexion inicial con Meta/Facebook mediante autorizacion oficial, device login/OAuth, seleccion de pagina, bienvenida y reconexion. El token manual queda solo como modo desarrollo/soporte controlado.

3. `03_home.md`
   Pantalla principal, alertas, lote activo, mini calendario, navegacion y acciones principales.

4. `04_lotes.md`
   Flujo central: subir fotos, analizarlas, elegir cantidad, generar variantes, asignar estilo por variante, aprobar/rechazar y cancelar.

5. `05_calendario.md`
   Calendario, programacion real en Facebook, edicion de fecha/hora, reintentos y estados de publicacion.

6. `06_configuracion.md`
   Configuracion de negocio, autonomia, SEO por pagina, tipos de contenido y editor de estilos visuales.

7. `07_ia.md`
   Inteligencia integrada y jobs: memoria, autonomia, decisiones, asignacion de estilos, prompts, captions, ranking, workers y proveedores IA.

8. `08_api.md`
   Backend Fastify, comandos, lecturas, jobs, contratos, DB primaria, Supabase Storage, cache/snapshot y errores.

9. `09_despliegue.md`
   Como levantar, desplegar, compilar APK, operar, diagnosticar y reconstruir el sistema.

10. `10_seguridad.md`
   Inventario completo de APIs internas y externas, control de paginas, variables de entorno y reglas de seguridad para no mostrar secretos.

11. `11_datos.md`
   Contratos duros de entidades, estados, transiciones, esquema Supabase recomendado y reglas de persistencia.

12. `12_ux_qa.md`
   Navegacion movil, sistema visual, reglas de imagen completa en aprobacion y matriz de pruebas/aceptacion.

13. `13_auditoria.md`
   Revision final contra el codigo actual, huecos encontrados y estado de completitud de la documentacion.

14. `14_comunicacion.md`
   Contrato maestro de comunicacion entre modulos: responsabilidades, fuente de verdad, eventos, refresco de UI y reglas anti-contradiccion.

15. `15_decisiones_tecnologicas.md`
   Juicio profesional de tecnologias por trabajo concreto: que se conserva, que se cambia, que se evita y por que, con fuentes externas.

16. `16_ui_engagement.md`
   Direccion de IU movil, loops de engagement etico, patrones por pantalla, microcopy, componentes y reglas anti-patron oscuro.

17. `17_backlog_implementacion.md`
   Backlog tecnico por fases: orden de construccion, dependencias, historias, criterios de aceptacion, MVP controlado y primer sprint recomendado.

## Principio de esta documentacion

Estos documentos describen el producto como debe existir, no solo como un inventario de codigo. Incluyen:

- Proposito de cada pantalla.
- Contratos entre app movil, API, jobs, workers, proveedores externos y servicios internos de IA.
- Contrato maestro para que todos los modulos se comuniquen por estados, eventos y respuestas eficientes.
- Matriz de decisiones tecnologicas para evitar usar herramientas incorrectas por costumbre.
- Estados de negocio, lote, foto, variante y publicacion.
- Reglas de seguridad y cancelacion.
- Copy visible al usuario.
- Reglas de diseno funcional.
- Reglas de IU practica y engagement etico para que el producto sea rapido, agradable y recurrente sin manipular al usuario.
- Especificacion de datos suficiente para rehacer tipos, endpoints y persistencia.
- Notas de reconstruccion para otro equipo o para una IA generadora de software.

## Autoridad documental para evitar redundancias

Cuando un tema aparece en varios documentos, esta tabla define cual manda:

| Tema | Documento fuente | Los demas documentos deben |
| --- | --- | --- |
| Vision, alcance y mapa general | `01_base.md` | Resumir o enlazar, no redefinir. |
| Modelo comercial, alcance MVP y limites de producto | `01_base.md` | No prometer automatizacion o canales fuera de alcance. |
| Conexion Meta/onboarding | `02_meta.md` | Mantener copy y flujos alineados. |
| Pantallas especificas | `03_home.md` a `06_configuracion.md` | Definir solo comportamiento propio de pantalla. |
| IA, jobs y proveedores IA | `07_ia.md` | No duplicar prompts/reglas IA completas. |
| Rutas, comandos, lecturas y respuestas | `08_api.md` | No inventar endpoints alternos. |
| Operacion y reconstruccion | `09_despliegue.md` | No repetir checklist de deploy fuera de contexto. |
| Seguridad, secretos y exposicion | `10_seguridad.md` | Obedecer reglas sin reescribirlas. |
| Datos, estados, tablas y transiciones | `11_datos.md` | Usar mismos nombres y estados. |
| QA y criterios de aceptacion | `12_ux_qa.md` | Validar, no definir patrones base. |
| Comunicacion entre modulos | `14_comunicacion.md` | Seguir contratos e invalidaciones. |
| Decisiones tecnologicas | `15_decisiones_tecnologicas.md` | Citar la decision, no reargumentarla. |
| Patrones de IU y engagement | `16_ui_engagement.md` | Especializar por pantalla, no redefinir. |
| Backlog y orden de implementacion | `17_backlog_implementacion.md` | Convertir especificacion en tareas; no redefinir contratos. |

Regla:

- Si un documento necesita repetir una regla transversal, debe hacerlo en una frase corta y apuntar al documento fuente.
- Si dos documentos parecen contradecirse, manda la tabla anterior salvo que `10_seguridad.md` o `11_datos.md` impongan una restriccion mas estricta.

## Limites intencionales

- No se copian tokens, secretos ni datos locales de `apps/api/data`.
- No se documentan credenciales reales de Render, Expo, Meta, Supabase ni OpenAI.
- No se modifica nada dentro de `TapalpaDamus`.
- No se recomienda depender de la PC local para operacion diaria.

