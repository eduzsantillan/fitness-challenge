# Verificación — Ritmo v1, retos y pasos

## Estado de entrega

- Implementación local completa de Mis retos / Mi perfil, sin dashboard ni entrenamiento en UI.
- Migración `002_simple_steps.sql` **aplicada a la base propia `fitness_challenge`** y repetida sin cambios el 31 de octubre de 2026. Es aditiva; `001` intacta. Ambas tablas nuevas verificadas por catálogo en lectura: runtime con CRUD, sin superuser/CREATEDB/CREATEROLE/CREATE de esquema. No se leyeron/escribieron registros de usuarios reales ni se tocaron las bases `noemi`/`calle`.
- **La validación descrita es local; el despliegue depende del pipeline Vercel tras el push solicitado.** No se modificaron DNS, variables remotas ni secreto de autenticación. La migración requerida está preparada antes de publicar.
- La prueba física del nuevo envío de Atajos queda pendiente. No se afirma que simplificar la petición haya solucionado el error intermitente de conexión del iPhone.

## Pruebas automáticas finales

`npm run check` y `npm audit`:

- **134 pruebas unitarias**, 12 archivos: permisos/consentimiento, fechas, snapshots, códigos personales, revocación, JSON/cuerpo pequeño sin cabeceras, protección de las demás rutas, legacy Bearer, demo aislada, caché PWA y secretos cliente.
- **30 integraciones con PostgreSQL real desechable**: Better Auth/sesiones/cookies, SQL/roles limitados, creación y membresía, invitaciones, persistencia por usuario, cero/null, no duplicación, medianoche y zonas, concurrencia de reparación/renovación, código revocado, historia legacy canónica y archivo al dejar/eliminar reto.
- **Smoke HTTP anterior y nuevo**, con servidor real y dos cuentas ficticias: registro, zona/código, creador incluido, premio/duración, invitación privada, unión explícita, POST de pasos sin Authorization/cabeceras manuales, repetición no duplica, perfil privado, códigos ausentes de rankings. Se usa solamente loopback y base temporal.
- **26 pruebas de helpers** dentro de las 134: calendario lunes/mes, límites, faltantes/cero, snapshots repetidos, frases por escenario, empate, último día y resultados incompletos. Cada escenario tiene seis frases; se eligen determinísticamente, no al azar en cada render.
- **15 pruebas de demo** dentro de las 134: historial global único, premios/creación/miembro, invitación, código ficticio, ninguna llamada de red ni credencial real.
- Compilación TypeScript API/React, build PWA y empaquetado Vercel. Asserts de rutas anidadas también para `/api/steps`, `/me/activity`, `/me/code` e invitaciones. SPA no intercepta APIs. Bundle sin secretos locales, sin dependencias AWS.
- `npm audit`: 0 vulnerabilidades.

Las pruebas fijan una base temporal y `MIGRATION_DATABASE_URL=''`; nunca vuelven a cargar la conexión real desde `.env`. Los clústeres de pruebas se destruyen al cerrar. La migración remota se realizó separadamente con preflight de base y rol explícitos.

## Navegador local

Vista conectada a una base desechable con esquema final (no Neon):

- Registro ficticio de María y bootstrap automático de zona del navegador.
- Creación de «Brunch de domingo», siete días y premio «Un brunch y café para dos»; autora incluida sin paso adicional.
- Dos participantes ficticios, 6432/6100 pasos enviados por el endpoint nuevo, comprobados en el detalle real de la app.
- Perfil semanal y mensual muestran el mismo total personal, no suma de retos.
- Copiar código devuelve un texto privado de 43 caracteres sin revelarlo ni mostrarlo en captura; código oculto por defecto.
- Tamaño móvil medido a 389 píxeles CSS útiles: `scrollWidth === clientWidth` tanto en reto como en perfil. Vista de escritorio comprobada. Las dimensiones físicas de la herramienta no sustituyen un iPhone.
- Sin errores/warnings de consola en la comprobación final. Durante el desarrollo se reinició el entorno temporal al cambiar la migración; esos errores de esquema transitorio no corresponden al esquema final.
- Capturas locales con datos ficticios: `preview-v1-reto.png` y `preview-v1-perfil.png`, excluidas de subida Vercel.

Se protegen respuestas obsoletas por ruta/revisión: cambiar de reto no permite que una respuesta anterior muestre otro ni apunte acciones destructivas al actual. Las mutaciones pausan sondeo e invalidan perfiles previos para no restaurar un código revocado. Error 401 en sondeo limpia la pantalla privada.

## Límites y siguiente prueba

1. Publicar el código nuevo en Vercel conservando variables runtime existentes. La base ya tiene el esquema hasta003.
2. Registro/entrada real desde el dominio y dos iPhones, invitación y unión. Confirmar sesiones/cookies HTTPS del nuevo despliegue.
3. En Mi perfil copiar código y configurar POST `/api/steps` solo con `userCode` Text y `steps` Number. Sin fecha/zona/Authorization.
4. Confirmar `accepted:1` y total del día; repetir debe reemplazar, no sumar. Comprobar fuentes iPhone/Watch y medianoche local. Esto aún no está validado en hardware.
5. Probar Safari instalado/PWA, teclado y áreas seguras en teléfono. CSS/emulación no demuestran el tacto nativo real.
6. Antes de abrir registro público: verificación y recuperación por correo, contacto, privacidad, retención y baja de cuenta.

El código de usuario sustituye la ubicación de la credencial, no elimina su sensibilidad. Los demás endpoints mantienen sesión/origen; la implementación Authorization legacy se conserva y se prueba, pero no se utiliza desde la nueva UI. Comparar días entre distintas zonas no equivale a idénticas ventanas UTC; para el mismo corte de Salud, usar una zona compartida.

## Ampliación: cierre y premio — 31 de octubre de 2026

- Migración003 aplicada al Neon dedicado y repetida idempotentemente. Catálogo runtime confirmó ambas columnas de resultado, CRUD del historial y USAGE de secuencia, sin CREATE de esquema. Backfill interno de snapshots personales existentes; no se extrajeron ni mostraron datos reales.001/002/003 quedan inmutables.
- Nuevas pruebas de backend/memoria: medianoche y DST, último día inclusive, reglas de premio, empate, null/cero, solo, lectura autorizada, ingesta tardía en otro huso, recibo por ganador/idempotencia y anonimización sin recoronación.
- Diez nuevas integraciones PostgreSQL verifican reconstrucción histórica del corte, resultado congelado, recibo concurrente, falta de versiones pre-migración, bloqueo de invitaciones/escrituras tardías y retirada de ganador.
- Veintidós pruebas de presentación de cierre y siete SSR de UI: escenarios/frases, privacidad, reglas visibles al unirse, XSS, destinatario y confirmación. Glob Vitest incluye .test.tsx para que no se omitan pruebas JSX.
- Demo explícita con reto terminado ficticio. Navegador: acceso Terminados, vista final, responsable/destinatario, confirmación Recibido, formulario de revancha prellenado sin inscripción automática del grupo.390 píxeles CSS: clientWidth=scrollWidth=390; sin errores/warnings de consola. Capturas preview-cierre-*.png excluidas de Vercel.
- Celebración decorativa sin bucles, transform/opacity260ms con pequeños desfases, una vez por sesión en memoria y repetible a petición. No modal ni bloqueo de lectura; reduced-motion estático. Física iPhone sigue pendiente.
- Decisiones de diseño: resultado → reconocimiento → premio → siguiente reto. Referencias primarias: [Apple HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion) y [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback): movimiento intencional, breve, opcional, información de estado junto al elemento afectado.
- Historial append-only no tiene compactación automática en este piloto; consulta de cierre acotada a las fechas del reto. Revisar retención antes de abrir al público.
