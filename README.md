# Ritmo · retos privados de actividad

PWA en español para comparar pasos y duración de entrenamientos entre dos o más personas. **React/Vite + API en Vercel + PostgreSQL en Neon**, en un único proyecto y tu propio dominio. No requiere AWS ni publicación en App Store.

**Estado:** base **`fitness_challenge` creada y conectada a Neon**, en el entorno compartido que ya utiliza date-app. Tablas y credenciales propias, con pruebas funcionales contra Neon aprobadas y cuentas ficticias eliminadas. No se ha publicado en Vercel ni validado la lectura de Salud en un iPhone. Ver `docs/NEON.md` para la configuración actual.

## Cómo funciona

**Salud del iPhone → Atajos → `POST /api/shortcuts` de tu dominio → Neon → panel del reto.**

- Registro y acceso por email/contraseña con Better Auth. Cookies HttpOnly, Secure en HTTPS, sesión de 7 días; sin tokens de sesión en localStorage/sessionStorage ni respuestas JSON de acceso.
- Crear retos de 1–31 días, invitar con enlace que caduca en 7 días y aceptar compartir los totales explícitamente.
- Pasos y entrenamiento se comparan por separado. Vista diaria y semana de lunes a domingo, con zona horaria compartida.
- Cada participante genera su propia clave de Atajos, limitada a usuario/reto, con caducidad de 30 días, renovación y revocación.
- Un envío reemplaza el total de ese día, no se suma de nuevo. Los envíos antiguos no pisan los nuevos; los de solo pasos conservan el entrenamiento manual.
- La web actualiza la clasificación cada 45 segundos mientras está visible y permite actualización manual. Eso **no ejecuta el atajo**.
- Demostración claramente señalizada con dos participantes ficticios, solo en memoria de la pestaña. No recibe actividad real ni genera claves; nunca sustituye silenciosamente una sesión real que falla.

### Límites del piloto

- La web no accede a HealthKit. El atajo funciona en el iPhone de cada participante, con su permiso.
- **La lectura de pasos desde Atajos debe verificarse en tu iPhone.** Salud puede tener fuentes duplicadas (teléfono/reloj). No sumar muestras crudas sin comprobarlas.
- Entrenamiento: introducir manualmente las duraciones de los entrenamientos guardados en Fitness. El anillo verde de Ejercicio **no equivale** a duración de entrenamientos.
- No se garantiza sincronización cada 10 minutos, con el iPhone bloqueado ni sin internet. No hay cola offline de envíos.
- **Email sin verificar y sin recuperación de contraseña por correo.** No se ha configurado un proveedor de email. Guarda la contraseña en un gestor. Está explicado en el formulario; antes de abrir el servicio al público, implementar verificación/recuperación con un proveedor y probarlas.
- Es un reto de confianza: una clave válida no certifica que los números los haya medido el Watch ni impide que el participante los modifique.

## 1. Ver la demo local

Necesitas Node.js 22 y npm.

```bash
npm ci
npm run dev
```

Abre `http://127.0.0.1:5173`. Se inician Vite y la API local en `127.0.0.1:3001`. Sin configuración de servidor, se muestra la demo y el acceso explica qué falta. No se crea ninguna base automáticamente.

`npm run dev:web` inicia solo la interfaz. `npm run preview` también es **solo vista estática**: para probar cuentas reales localmente usa `npm run dev` con una base configurada.

## 2. Preparar una base propia

Usa una **base separada para Ritmo**, aunque se reutilice el mismo proyecto Neon. Ya se creó `fitness_challenge` en el entorno compartido existente, sin mezclar tablas con `noemi` o `calle`. El archivo `.env` local está configurado y protegido: **no lo reemplaces con el ejemplo si ya existe**. Los pasos siguientes son para configurar otro entorno desde cero.

1. Copia `.env.example` a `.env` (ignorado por Git).
2. Configura estas variables **solo de servidor**, sin prefijo `VITE_`:

| Variable | Qué poner |
| --- | --- |
| `DATABASE_URL` | Tu conexión PostgreSQL/Neon. No la compartas por chat. |
| `MIGRATION_DATABASE_URL` | Conexión del rol de migración, solo local. Nunca subirla a Vercel. Opcional en desarrollo si el usuario local ya es propietario. |
| `APP_ORIGIN` | Local: `http://127.0.0.1:5173`. Producción: tu origen HTTPS exacto, sin ruta ni barra final. |
| `BETTER_AUTH_SECRET` | Un secreto aleatorio propio, mínimo 32 caracteres. Genera uno con `openssl rand -base64 48`. No reutilices claves de otras apps. |
| `PG_POOL_MAX` | `3`, recomendado para este piloto; usa conexión pooled en Neon. |

3. Prepara las tablas explícitamente:

```bash
npm run db:migrate
```

Las migraciones están en `db/`, son transaccionales, llevan checksum y un bloqueo transaccional que funciona también con el pool de Neon. Ejecutarlas de nuevo no duplica tablas ni datos. **El servidor no ejecuta DDL automáticamente por petición.** No apliques estas migraciones a una base ajena.

En la configuración actual, `db:migrate` usa `MIGRATION_DATABASE_URL` y después concede CRUD al usuario de runtime, sin permitirle crear tablas ni editar el historial de migraciones. Se rechazan conexiones de migración que apunten a otra base/endpoint. `DATABASE_URL` sigue siendo la única conexión que lee el servidor de la app.

4. Inicia o reinicia `npm run dev`, abre exactamente el origen de `.env`, pulsa **Entrar a mi cuenta → Crear cuenta**.

La conexión remota verifica certificados TLS. No desactives la verificación SSL. No subas `.env`, no copies `DATABASE_URL` en el atajo y no la pongas en variables públicas de Vite.

## 3. Publicar en Vercel con tu dominio

> Estos pasos sí crean/configuran servicios externos. Los haces tú con tus cuentas y el plan que elijas. No hay cuota de App Store, pero Vercel/Neon tienen límites y condiciones propias; no se garantiza coste cero ilimitado.

1. La base Neon ya está preparada. Usa el `DATABASE_URL` limitado del `.env` de Ritmo, no el de date-app ni la conexión de migraciones. Si configuras otra base, aplica `npm run db:migrate` explícitamente antes.
2. Importa este repositorio completo en Vercel. **Root Directory = raíz del repositorio**, no `web/` ni `dist/`.
3. Selecciona preset **Vite**, Node.js **22.x**, Build Command **`npm run build`**, Output Directory **`dist`**. La API vive en `api/[...path].ts` fuera del directorio estático.
4. Añade en **Settings → Environment Variables → Production**: `DATABASE_URL`, `APP_ORIGIN`, `BETTER_AUTH_SECRET`, `PG_POOL_MAX`.
   **No añadas `MIGRATION_DATABASE_URL`**, no subas `.env` y no copies la credencial administrativa de date-app. `.vercelignore` excluye archivos privados del envío por CLI.
5. Añade tu dominio en **Settings → Domains**, configura el DNS que indique Vercel y pon ese mismo origen HTTPS en `APP_ORIGIN`.
6. Publica/republica el proyecto. La regla SPA de `vercel.json` excluye `/api/`; no la reemplaces por una regla que envíe toda la API a `index.html`.
7. Comprueba `https://TU_DOMINIO/api/status`: debe devolver JSON con `configured: true`, no HTML. Luego crea una cuenta real y prueba crear un reto. Status confirma configuración, **no sustituye una prueba de conexión/migraciones**.

No hacen falta variables `VITE_*`, claves AWS ni un dominio API separado. Interfaz y API usan el mismo origen. En previews, usa una base/rama de pruebas y su origen exacto, no los datos ni el secreto de producción. No desactives la protección del despliegue de preview para exponer actividad real.

Si usas protección de despliegue en el dominio de producción, el iPhone debe poder alcanzar el endpoint: el atajo no inicia sesión en la barrera de acceso de Vercel. Conserva siempre la protección propia de la API por sesión/clave; no publiques claves en URLs.

## 4. Prueba entre dos personas

1. Primera persona: registra una cuenta, crea un reto con zona horaria correcta y acepta compartir totales.
2. Genera una invitación y compártela con la segunda persona.
3. Segunda persona: registra **su propia cuenta** y acepta unirse al reto. No se unen personas automáticamente al abrir un enlace.
4. Cada persona abre **Conectar datos → Generar clave de Atajos**, copia URL, zona y su propia clave.
5. Sigue `docs/ATAJOS.md`: primero envío manual de un total conocido, después lectura de Salud si se puede validar. La sección 0 permite probar lectura sin desplegar nada.
6. Comprueba que repetir un envío no duplica pasos y que revocar la clave hace que el siguiente envío responda 401.

La guía se copia al compilar a `/guia-atajos.md` y puede descargarse desde la propia app. No se ha generado un `.shortcut` firmado ni enlace iCloud de instalación.

## API

Todas las rutas siguientes tienen prefijo `/api`. Las de retos requieren una **sesión de servidor válida**; no aceptan una identidad del cuerpo ni `Bearer local-*`. Las mutaciones del navegador exigen `Origin` exactamente igual a `APP_ORIGIN`. No se habilita CORS para otros sitios.

| Ruta | Función |
| --- | --- |
| `GET /status` | Disponibilidad de configuración, sin secretos |
| `GET /session` | Usuario público actual, o `null`; no devuelve tokens |
| `POST /auth/sign-up/email` | Registro `{name,email,password}` |
| `POST /auth/sign-in/email` | Acceso `{email,password}` |
| `POST /auth/sign-out` | Revoca la sesión actual y borra cookie |
| `GET/PUT /me` | Perfil visible |
| `DELETE /me/data` | Borra actividad/participación y retos propios, con `{confirm:"DELETE"}`; conserva cuenta de acceso |
| `GET/POST /challenges` | Listar/crear retos |
| `POST /join` | Aceptar invitación y consentimiento |
| `GET /challenges/:id` | Datos y miembros del reto |
| `POST /challenges/:id/invites` | Crear invitación, solo propietario |
| `GET /challenges/:id/leaderboard` | Totales y días del grupo |
| `PUT/DELETE /challenges/:id/activity` | Guardar snapshots propios/borrar y revocar conexión |
| `GET/POST/DELETE /challenges/:id/connection` | Estado/rotar/revocar clave Atajos |
| `DELETE /challenges/:id/membership` | Salir; si es propietario, eliminar reto completo |
| `POST /shortcuts` | Única ruta que acepta la clave Bearer de Atajos, sin cookie ni Origin |

Ejemplo de cuerpo de Atajos (ficticio):

```json
{ "date": "2026-10-30", "steps": 4856, "timeZone": "America/Toronto" }
```

Cabecera `Authorization: Bearer TU_CLAVE_PERSONAL`, `Content-Type: application/json`. `steps` es número entero. Si no hay datos, no envíes un cero inventado. `workoutSeconds` es opcional; omitirlo conserva entrenamiento manual. `capturedAt` ISO es opcional; sin él se usa la hora de recepción. La API responde `accepted` y `syncedAt`.

## Seguridad y conservación

- Better Auth se encarga del hashing de contraseñas y firma de cookies. No se implementó criptografía de contraseñas propia. Sesiones consultadas en base en cada solicitud; no se usa caché de cookies que mantenga una sesión revocada.
- SQL parametrizado y claves foráneas con borrado en cascada. Escrituras por reto con bloqueo transaccional; un envío retrasado no recupera datos tras revocar/borrar/salir.
- Runtime conectado como `fitness_challenge_app`, sin CREATE de esquemas/tablas, TRUNCATE, membresías de roles administrativos ni acceso al historial de migraciones. `fitness_challenge_migrator` es dueño de sus tablas y se usa solo desde el entorno local para migrar. Las credenciales administrativas de date-app nunca se guardaron en Ritmo.
- Se verificó sin consultar filas personales que el rol de runtime no puede leer/escribir tablas ni crear objetos en los esquemas `public` de `noemi` y `calle`. No se modificaron permisos de esas bases. Compartir proyecto mantiene administradores y recursos comunes; **no es aislamiento total** frente a un administrador del proyecto.
- Invitaciones y claves Atajos de alta entropía, guardadas solo como SHA-256. Rotar reemplaza atómicamente la credencial anterior. Cada envío valida también pertenencia y caducidad dentro de la transacción.
- Límites compartidos y atómicos en Postgres, no solo en memoria de una función. Identificadores de rate limit guardados como HMAC; no se guardan IP/user-agent en las sesiones. Vercel recibe la IP y puede conservar sus propios registros según su configuración.
- El adaptador local sustituye `x-real-ip` por la dirección del socket; en producción se confía en el encabezado proporcionado por Vercel. No alojar este código detrás de un proxy que permita al cliente suplantarlo sin adaptarlo.
- No se registran cuerpos, contraseñas, cookies, emails, claves ni pasos en logs de aplicación. Nunca añadas logs de `error` de Postgres con conexiones/payloads.
- Caché PWA solo de interfaz y assets; rutas `/api`, autenticación, queries, POST y respuestas privadas no se guardan. Actividad real requiere internet; no hay persistencia offline ni cola de reintentos.
- Borrar actividad o datos de la app **conserva el email, nombre de registro y credenciales de acceso**. Para una baja total en este piloto, el responsable debe verificar la identidad y eliminar la fila de `auth_user` de esa persona; las relaciones y sesiones se borran por cascada. No hay aún autoservicio de borrado total de cuenta.
- La base Neon contiene totales sensibles. Configura región, permisos de acceso, copias, historial y retención conscientemente. Esto no es cifrado de extremo a extremo ni garantía de cumplimiento normativo. No reutilices producción en demos o previews.
- Antes de invitar usuarios reales, publica contacto del responsable y política de conservación/baja, y explica límites del piloto. Antes de abrir registro público, añadir verificación/recuperación por correo y revisar controles de abuso.

Para limpiar registros ya caducados, el responsable puede ejecutar explícitamente `npm run db:cleanup`; no se ha creado una tarea programada. No borra actividad vigente. Revisa y documenta la retención independiente de copias/historial de Neon.

## Verificaciones

```bash
npm run typecheck
npm test
npm run test:integration
npm run build
npm run verify:deploy
```

`npm run check` ejecuta todo. `test:integration` exige `initdb` y `pg_ctl` locales (PostgreSQL 14+; se puede indicar `PG_BIN`). Crea un clúster temporal con solo datos ficticios, corre pruebas contra PostgreSQL y un smoke HTTP con registro/login reales, lo detiene y elimina. **Ignora la base del usuario y no llama a Neon ni crea recursos externos.** `npm run test:http` ejecuta solo la parte HTTP en otro clúster desechable.

La prueba remota es explícita y separada: `npm run neon:verify -- --allow-test-writes`. Crea dos cuentas ficticias con identificadores únicos, comprueba el flujo completo de API contra `fitness_challenge` y elimina solo sus registros al terminar. No ejecutarla como prueba automática de cada build. El último resultado sin secretos está en `docs/neon-verification.json`.

El build de Vercel no necesita PostgreSQL local: usa `npm run build`, no `npm run check`. El empaquetado local de la función y pruebas no equivalen a un despliegue real verificado. Ver `docs/VERIFICATION.md`.

## Estructura

- `web/src/`: panel, acceso, demo y cliente same-origin.
- `api/[...path].ts`: única entrada de Vercel para la API.
- `backend/src/`: Better Auth, servicio de retos, repositorio PostgreSQL, límites y migraciones.
- `db/`: migraciones SQL versionadas.
- `backend/tests/`, `backend/integration/`, `web/tests/`: pruebas.
- `docs/ATAJOS.md`: guía de iPhone y envío de datos.
- `scripts/`: desarrollo, migraciones, clúster de prueba, build PWA y comprobaciones.

Fuentes: [Vercel Node Functions](https://vercel.com/docs/functions/runtimes/node-js), [Neon con Vercel](https://neon.com/docs/guides/vercel-overview), [Better Auth](https://better-auth.com/docs/installation), [Atajos y peticiones HTTP](https://support.apple.com/en-mt/guide/shortcuts/apd58d46713f/ios).
