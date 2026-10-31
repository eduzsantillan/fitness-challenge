# Atajos para Ritmo — versión simple de pasos

Esta guía corresponde a la nueva experiencia **Mis retos / Mi perfil**. La versión está desplegada con el esquema hasta003. El usuario confirmó el envío desde su iPhone al cambiar la URL a `/api/steps`. Falta comprobar la exactitud del total de Salud y las automatizaciones; no se generaliza esa prueba a todas las conexiones o dispositivos.

## Qué se envía

Solo dos campos:

```json
{
  "userCode": "TU_CODIGO_PRIVADO",
  "steps": 90
}
```

`90` es un ejemplo: envía tu total real de pasos de hoy. **No se envían** `date`, `timeZone`, `capturedAt`, ID de reto, contraseña, cookies ni `Authorization`. No necesitas configurar Headers manualmente. El endpoint acepta JSON sin Content-Type explícito; el cuerpo debe seguir siendo un objeto JSON válido.

El servidor calcula la fecha al recibirlo, usando la zona horaria guardada por la app cuando abres tu perfil por primera vez. El iPhone y el perfil deben usar la misma zona. El atajo es para **hoy**, no para importar días anteriores. Un envío reemplaza el total diario anterior: nunca se suman dos veces los mismos pasos.

## 1. Copiar tu código

1. Entra a [Ritmo](https://ritmo.eduzsantillan.com), crea tu cuenta o inicia sesión.
2. Abre **Mi perfil**. La app guarda automáticamente la zona del navegador si el perfil todavía no tiene una.
3. Despliega **Atajos y código** y toca **Copiar mi código**.
4. Es privado: quien lo tenga puede actualizar tus pasos, no leer tu cuenta. Cada participante utiliza el suyo, incluso si está en varios retos.

No lo envíes por chat ni lo publiques dentro de una plantilla compartida. Si lo compartiste por error, usa **Renovar mi código** y actualiza el atajo. La demo nunca genera códigos reales.

## 2. Leer los pasos de hoy

En Shortcuts, crea o conserva este bloque:

1. **Find Health Samples**:
   - **Type → Steps**.
   - **Start Date → is today**.
   - **Unit → count**.
   - **Group by → Day**.
   - **Sort by → None**.
   - **Limit → apagado**.
2. **Get Details of Health Samples**: selecciona **Value**. La entrada debe ser el resultado de **Find Health Samples**.
3. **Set Variable → PasosRitmo**, usando ese valor.

Antes del primer envío, usa **Quick Look** para comprobar el número. No uses **Log Health Sample**: registra datos nuevos en Salud en vez de leerlos.

Una coincidencia inicial con Salud no garantiza deduplicación para todos los días o fuentes. Si aparecen muestras de iPhone y Watch, no sumes ambas sin validar: pueden medir el mismo paseo. Si no hay permiso o datos, detén el atajo; no inventes un cero. Cero solo significa una medición conocida de cero pasos.

## 3. Enviar a Ritmo

Elimina los bloques de **Date**, **Format Date**, **DiaRitmo** y cualquier configuración anterior de cabeceras. Conserva el bloque de lectura y añade:

1. **URL**:

```text
https://ritmo.eduzsantillan.com/api/steps
```

2. **Get Contents of URL**:
   - Entrada: la **URL** anterior.
   - **Method → POST**.
   - **Headers → vacío**. No Authorization ni Bearer.
   - **Request Body → JSON**.
   - **Add new field**:

| Key | Tipo | Valor |
| --- | --- | --- |
| `userCode` | Text | Tu código privado copiado de Mi perfil |
| `steps` | Number | Selecciona la variable `PasosRitmo` |

Para `steps`, inserta solo la variable: no dejes el `0` predeterminado delante. No escribas el nombre `PasosRitmo` como texto ni añadas unidades o separadores de miles. `"90"` como texto no es un número JSON.

3. **Show Result**, conectado al resultado de la petición.
4. Ejecuta con el iPhone desbloqueado. Si pide permiso, revisa y autoriza lectura de Steps y conexión a tu dominio.

Una respuesta correcta tiene este formato (fecha/hora ilustrativas):

```json
{"accepted":1,"date":"2026-10-31","syncedAt":"2026-10-31T16:00:00.000Z"}
```

Abre **Mi perfil** o el reto y actualiza la vista. Comprueba el mismo total. Los pasos personales se reflejan automáticamente en los retos de los que formas parte, dentro de sus fechas y desde tu ingreso. El historial permanece aunque dejes un reto. Las personas en zonas distintas comparan sus propias fechas locales, no ventanas UTC idénticas; para el mismo corte diario, usen la misma zona.

## 4. Si algo falla

- **Código no válido**: copia tu código de Mi perfil otra vez. Renovarlo revoca el anterior. No uses el código ficticio de la demo ni una antigua clave de reto.
- **Abre tu perfil para configurar la zona**: entra a Mi perfil en la versión nueva antes de enviar.
- **Envía solo userCode y steps**: quita fecha, zona y otros campos del cuerpo.
- **steps no es válido**: tipo Number, entero entre 0 y 250000, sin prefijos ni unidades.
- **Demasiadas solicitudes**: espera un minuto; no hagas un bucle permanente.
- **The network connection was lost**: no demuestra un error en los datos. Conserva el atajo original y prueba uno nuevo con URL `/api/status`, GET y sin cabeceras. Compara Safari, reinicio de Shortcuts y Wi-Fi/datos móviles; comparte solo el resultado, nunca tu código.

No hay cola offline ni sincronización continua. Actualizar la web no ejecuta el atajo. No se garantiza lectura con teléfono bloqueado ni ejecución cada diez minutos. En esta versión solo se muestran pasos; la implementación anterior de entrenamientos/Authorization permanece en el servidor sin ser utilizada por este flujo.

## Compartir una plantilla

Primero valida el envío. Duplica el atajo, borra el código real y añade una pregunta de configuración para que cada persona pegue el suyo. Comparte una copia limpia por enlace iCloud. Los permisos de Salud y red los concede cada usuario. Todavía no se generó un enlace iCloud ni un `.shortcut` firmado.

## Referencias

- [Enviar una petición con Shortcuts — Apple](https://support.apple.com/en-mt/guide/shortcuts/apd58d46713f/ios).
- [Compartir atajos — Apple](https://support.apple.com/guide/shortcuts/share-shortcuts-apdf01f8c054/ios).
- [Error de conexión interrumpida — Apple](https://developer.apple.com/library/archive/qa/qa1941/_index.html).

El flujo anterior con claves por reto y Authorization se conserva como referencia técnica en `docs/ATAJOS-LEGACY.md`; no se usa para configurar esta versión.
