# Guía de Atajos para Ritmo

## Qué hace y qué no hace

Un atajo es una pequeña secuencia que ejecutas en tu iPhone. En esta app sirve de puente: **iPhone → petición HTTPS → API de tu web en Vercel → Neon → clasificación del reto**. La PWA no puede consultar Salud por sí misma.

**Estado de esta versión:** el receptor, las claves y las validaciones están implementados y probados tanto localmente como contra la base Neon `fitness_challenge`, con cuentas ficticias que se eliminaron al terminar. La web aún no está publicada en Vercel. La lectura de muestras de Salud, los menús concretos de Atajos y su comportamiento con el teléfono bloqueado **no se han validado en un iPhone físico**. No hay un archivo `.shortcut` firmado ni un enlace iCloud de instalación automática; esta guía explica cómo crearlo.

- Pasos: primero prueba el envío manual; después puedes probar la lectura de Salud y contrastarla.
- Entrenamiento: en esta versión se introduce manualmente la duración de los entrenamientos guardados en Fitness. No se automatiza la lectura de `HKWorkout`.
- **No uses “minutos de ejercicio” del anillo verde como sustituto.** Es otra métrica.
- No es tiempo real continuo. La web refleja el último envío recibido.
- Una clave solo permite enviar actividad del usuario que la creó al reto seleccionado. No permite leer clasificaciones ni entrar a la cuenta.

## 0. Prueba en iPhone antes de desplegar

Esta prueba solo lee y muestra datos en el iPhone: no necesita servidor, URL ni clave.

1. Abre **Atajos / Shortcuts** en el iPhone y toca **+**. Nombra el atajo **Probar pasos de hoy**.
2. Busca exactamente **Buscar muestras de Salud / Find Health Samples**. **No uses Log Health Sample / Registrar muestra de Salud**: esa acción escribe un registro nuevo y puede mostrar `0 count` aunque sí hayas caminado. No rellenes ese Value con el total de Salud.
3. Configura **Type → Steps** y **Start Date → is today**. Desactiva **Limit** si aparece. Si existe **Group by**, prueba **Day**.
4. Añade **Vista rápida / Quick Look**, conectada a la salida **Health Samples**.
5. Ejecuta con el iPhone desbloqueado y concede solo lectura de **Steps**.
6. Inspecciona la salida. Una lista de muestras no es aún un total diario validado: no sumes iPhone y Watch sin contrastar fuentes. Si no encuentras los filtros, comparte una captura solo del bloque de configuración, sin datos privados.
7. Revisa la sección 3 para validar fuentes antes de conectar los envíos. Los menús concretos siguen pendientes de prueba en tu versión de iOS.

## Antes de empezar con los envíos

1. Para enviar datos, el responsable debe haber publicado el proyecto completo en Vercel y aplicado las migraciones a Neon. Para probar solo lectura de Salud, usa la sección 0 sin desplegar nada. En modo demostración no puedes recibir datos reales ni generar claves.
2. Entra con tu cuenta, configura tu nombre en **Ajustes** y crea un reto o acepta una invitación.
3. Comprueba la **zona horaria del reto**. Para este piloto, usa el iPhone en esa misma zona horaria; no cambies la zona del dispositivo a mitad del registro.
4. En el iPhone, abre la app **Atajos**. No necesitas una cuenta de desarrollador de Apple.

## 1. Obtener la URL y tu clave

En la PWA abre **Conectar datos** y selecciona el reto correcto.

1. Toca **Generar clave de Atajos**.
2. Copia la **URL de envío** (tu dominio seguido de `/api/shortcuts`), la **zona horaria** y la **clave**.
3. La clave se muestra solo en esta pantalla; no se almacena en el navegador. Guárdala únicamente dentro de tu atajo privado.
4. Caduca en 30 días. Generar otra invalida la anterior inmediatamente para nuevos envíos. **Revocar conexión** la deshabilita sin cerrar tu cuenta.

No envíes la clave por WhatsApp, no la pongas en un enlace y no la compartas con otro participante. Cada persona crea su propia conexión. No copies tu contraseña de usuario, cookies ni DATABASE_URL de Neon en Atajos.

## 2. Primera prueba: enviar un total conocido

Empieza con esta variante para comprobar URL, clave, fecha y formato sin mezclar errores de lectura de Salud. Los nombres de acciones pueden variar según idioma y versión de iOS.

### A. Preparar las variables

Crea un atajo llamado **Enviar a Ritmo** y añade:

1. **Texto**: pega la URL de envío. Usa **Definir variable** para llamarla `URLRitmo`.
2. **Texto**: pega tu clave privada. Define la variable `ClaveRitmo`.
3. **Texto**: pega exactamente la zona horaria de la PWA, por ejemplo `America/Toronto`. Define `ZonaRitmo`.
4. **Fecha actual**.
5. **Dar formato a fecha**: formato personalizado `yyyy-MM-dd`. Usa calendario gregoriano y, si aparece la opción de configuración regional, `en_US_POSIX`. Define `DiaRitmo`.
   - Usa `yyyy`, no `YYYY`, para evitar errores de año en las últimas semanas de diciembre.
   - Usa la fecha local de la zona del reto. El texto debe verse como `2026-10-30`, sin hora.
6. **Solicitar entrada** de tipo **Número**: “¿Cuántos pasos muestra Salud hoy?”. Consulta el total del día en Salud y define la respuesta como `PasosRitmo`.

No pongas un cero si no hay datos o no tienes permiso: detén el atajo o registra manualmente en la PWA dejando el campo vacío.

### B. Enviar al servidor

Añade **Obtener contenido de URL** con la variable `URLRitmo`:

- Método: **POST**.
- Cabeceras:
  - `Authorization`: `Bearer ` seguido de la variable `ClaveRitmo` (hay un espacio después de Bearer).
  - `Content-Type`: `application/json`.
- Cuerpo de solicitud: **JSON**.
- Campos:

| Campo | Tipo en Atajos | Contenido |
|---|---|---|
| `date` | Texto | Variable `DiaRitmo` |
| `steps` | Número | Variable `PasosRitmo` |
| `timeZone` | Texto | Variable `ZonaRitmo` |

**No añadas `workoutSeconds` en esta primera prueba.** Si ya habías guardado el entrenamiento manualmente, el envío de solo pasos conserva esa duración. Tampoco hace falta `capturedAt`: el servidor registra el momento del envío.

Ejemplo del formato, con valores ficticios:

```json
{
  "date": "2026-10-30",
  "steps": 8642,
  "timeZone": "America/Toronto"
}
```

Las comillas del ejemplo pertenecen al formato JSON; en el editor de cuerpo JSON, selecciona **Número** para pasos. `"8642"` como texto se rechaza.

### C. Verificar el resultado

1. Añade **Vista rápida** o **Mostrar resultado** después de la petición.
2. En el primer uso, autoriza únicamente los accesos que hayas revisado: conexión a la URL de tu backend y, si usas la siguiente variante, lectura de pasos.
3. Una respuesta correcta incluye `accepted: 1` y `syncedAt`. Si hay un campo `message`, lee el error; no muestres “Sincronizado” sin comprobar la respuesta.
4. Abre la PWA, selecciona **Hoy** y toca **Actualizar vista**.
5. Comprueba que aparece exactamente el total que enviaste.
6. Ejecuta otra vez con el mismo total: **no debe duplicarse**. El día se actualiza, no se suma otra copia.

## 3. Probar la lectura de pasos desde Salud

Solo sustituye la acción “Solicitar entrada” cuando la prueba anterior funcione.

1. Añade **Buscar muestras de Salud** (`Find Health Samples`).
2. Elige el tipo **Pasos**, limitado al día de hoy. Quita cualquier límite de resultados que pudiera truncar el día.
3. Revisa si tu versión permite **Agrupar por día** y seleccionar la **fuente/origen**. Para una prueba con solo Watch, selecciona la fuente concreta de tu reloj si ese filtro está disponible.
4. Obtén el valor numérico del resultado diario con la acción de detalles de muestra que ofrezca tu versión y asígnalo a `PasosRitmo`.
5. **Antes de enviar**, muestra el número en pantalla y compáralo con Salud para la misma fecha y fuente.

### Riesgo importante: contar dos veces

Salud puede contener muestras tanto del iPhone como del Watch. **No sumes directamente todas las muestras mezcladas**, ni asumas que la agrupación de Atajos reproduce la combinación y prioridad de fuentes de Salud.

El total de una única fuente Watch también puede diferir del total combinado de Salud porque no incluye los pasos del teléfono cuando no llevabas el reloj.

**Si no puedes verificar un total coherente, si faltan los filtros o si la acción no devuelve un único total diario entendible, conserva la variante manual.** No inventes una fórmula de deduplicación ni presentes como validado el dato automático. Esta parte requiere probar tu versión de iOS y tus fuentes reales.

El receptor identifica el envío como procedente de Atajos, pero eso **no certifica** que lo haya medido un Watch ni que no haya sido modificado. El piloto es un reto de confianza, no un sistema antifraude.

## 4. Registrar la duración de los entrenamientos

La opción disponible y comprobable en esta versión es:

1. Abre **Fitness** y consulta los entrenamientos guardados del día.
2. Suma sus **duraciones de entrenamiento**, no el tiempo transcurrido incluyendo pausas, ni el anillo Ejercicio.
3. En Ritmo toca **Registrar actividad**, elige el día e introduce los minutos. Deja el campo vacío si no hay información disponible; introduce `0` solo si conoces que ese día hubo cero minutos.

Si prefieres escribir la duración dentro del atajo, añade otra **Solicitar entrada — Número** con los minutos que acabas de comprobar en Fitness, después **Calcular** multiplicando por `60`, y añade el resultado al cuerpo JSON como `workoutSeconds` de tipo Número. Esto sigue siendo **entrada manual**, no lectura automática de entrenamientos.

Para este piloto, atribuye un entrenamiento al día en que empezó. No cuentes dos veces un entrenamiento repetido por otra app. Una lectura automática fiable de los objetos de entrenamiento queda fuera de esta implementación PWA sin app puente.

## 5. Uso diario y automatizaciones opcionales

- Ejecútalo con un toque cuando el Watch haya sincronizado y el iPhone esté desbloqueado.
- Puedes añadir el atajo a la pantalla de inicio o a un widget.
- Empieza enviando los datos al final del día. Para completar días anteriores, usa el formulario de la PWA; esta guía inicial consulta “hoy”.
- Después de validar todo, puedes explorar una automatización personal de Atajos por hora del día. No está creada por esta app ni verificada aquí.
- No existe un intervalo nativo «cada 10 minutos»: programar muchas horas no garantiza poder leer Salud. No uses un bucle de Esperar como servicio permanente.
- No se garantiza ejecución con el teléfono bloqueado, permisos restringidos o falta de red. Los errores requieren volver a ejecutar; no hay cola automática de envíos.
- Actualizar la PWA **no ejecuta** el atajo ni despierta el Watch.

## 6. Resolver problemas

| Mensaje/síntoma | Qué revisar |
|---|---|
| 401 / clave no válida o caducada | Genera otra en la PWA, actualiza el texto privado del atajo y comprueba el espacio después de `Bearer`. |
| 403 / no perteneces al reto | Puede haberse eliminado el reto o tu participación. Entra a la PWA con tu cuenta. |
| Zona horaria diferente | Copia exactamente la zona del reto y asegúrate de que el día del iPhone usa la misma zona. |
| Fecha fuera del reto o futura | Solo se admiten días del reto que ya hayan empezado en su zona horaria. |
| `steps` no válido | Envía un número entero, no texto con separadores de miles. |
| Número distinto a Salud | Revisa fecha, fuentes y sincronización. No sumes fuentes duplicadas; usa entrada manual si no puedes comprobar el total. |
| Entrenamiento aparece “—” | Significa que aún no hay duración conocida. Introduce los minutos guardados en Fitness. |
| No cambió la clasificación | Comprueba `accepted: 1`, el reto seleccionado, el periodo Hoy/Semana y actualiza la vista. |
| Sin internet | Ejecuta otra vez cuando vuelva la conexión. No se confirma un envío que no llegó. |
| 429 / demasiadas solicitudes | Espera y vuelve a ejecutar una sola vez. No lo configures para enviar cada segundo. |

## 7. Privacidad

- Revisa las acciones antes de instalar o compartir un atajo.
- Solo se envían los totales que introduzcas o autorices; no subas un archivo completo de Salud.
- Nunca compartas una copia del atajo que contenga tu clave. Revócala si la has compartido por error.
- La clave es personal por reto. Cada participante crea la suya.
- En la PWA puedes revocar Atajos, borrar tu actividad o salir del reto. El creador que elimina un reto borra también los registros compartidos de sus participantes.
- El borrado de actividad no elimina el email, nombre de registro ni contraseña de tu cuenta. Para eliminar también la cuenta, contacta al responsable del piloto. Las copias y el historial de Neon tienen retención independiente según el plan; el responsable debe documentarlo.

## Fuentes oficiales

- [Acciones Buscar y Filtrar de Atajos — Apple](https://support.apple.com/en-asia/guide/shortcuts/apd3c845e881/ios)
- [Enviar datos a una API con Atajos — Apple](https://support.apple.com/en-mt/guide/shortcuts/apd58d46713f/ios)
- [Permisos de privacidad de Atajos — Apple](https://support.apple.com/en-gb/guide/shortcuts/apd961a4fc65/ios)
- [Diferencia: minutos del anillo Ejercicio — Apple](https://developer.apple.com/documentation/healthkit/hkactivitysummary/appleexercisetime)
- [Duración de un entrenamiento — Apple](https://developer.apple.com/documentation/healthkit/hkworkout/duration)

La disponibilidad general de estas acciones está documentada. Los menús, la exactitud de los totales y el flujo completo deben comprobarse con un iPhone físico antes de usar datos reales en el reto.
