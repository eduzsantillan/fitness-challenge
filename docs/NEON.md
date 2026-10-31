# Neon conectado a Ritmo

## Estado actual

- Base propia: **`fitness_challenge`**, en el mismo entorno Neon que ya contiene `noemi` (date-app) y `calle`.
- Migraciones `001_initial.sql` y `002_simple_steps.sql` aplicadas. La segunda añade premio, zona/código privado de perfil, snapshots personales y archivo de historial legacy, sin borrar tablas anteriores. Se repitió db:migrate y se verificaron permisos limitados en lectura.
- Configuración local guardada en `.env`, ignorada por Git y Vercel, permisos `0600`.
- Registro, cookies de sesión, invitaciones, dos participantes, actividad manual, envíos de Atajos, persistencia, deduplicación y revocación comprobados contra Neon real.
- Las cuentas/actividad ficticias de verificación se eliminaron. No se importaron registros de date-app o calle.
- **Despliegue del usuario:** `https://ritmo.eduzsantillan.com`. Última comprobación del 31 de octubre de 2026: `/api/status` y `/api/session` ya responden HTTP 200 (`configured: true`, sesión anónima), resuelto el 503 inicial. Los registros de peticiones de Vercel y sondas sin credenciales muestran HTTP 404 de plataforma en rutas anidadas de registro/retos. Corregido localmente con `api/index.ts` y rewrite explícita `/api/(.*)` → `/api`; falta publicar esta corrección y confirmar registro. Mantener `APP_ORIGIN=https://ritmo.eduzsantillan.com` sin barra final; no recrear Neon.
- **Pendiente:** confirmar configuración/sesiones reales en Vercel y probar Salud en el iPhone.

No incluimos conexiones, contraseñas, endpoints privados ni secretos en este documento.

## Credenciales separadas

| Uso | Rol | Variable | Dónde se utiliza |
| --- | --- | --- | --- |
| Aplicación | `fitness_challenge_app` | `DATABASE_URL` | Servidor local y Vercel |
| Migraciones | `fitness_challenge_migrator` | `MIGRATION_DATABASE_URL` | Solo entorno local del responsable |

El usuario de la app solo tiene `CONNECT`, `USAGE` de su esquema y CRUD de las tablas de Ritmo. No es propietario, no tiene privilegios administrativos ni puede crear esquemas/tablas, truncar tablas o alterar `ritmo_migrations`.

El usuario de migraciones puede crear y modificar sus objetos en el esquema de Ritmo. Las futuras migraciones se ejecutan con `npm run db:migrate`, que también actualiza los permisos CRUD del runtime. No es la credencial de date-app.

## Qué se verificó de las otras bases

- Catálogos de `noemi`/`calle` inspeccionados en modo `READ ONLY`, sin leer filas de sus aplicaciones.
- Sin permisos de lectura/escritura de tablas ni creación de objetos en sus esquemas `public` para `fitness_challenge_app`.
- Esquemas y ACLs de ambas bases, y archivo de configuración de date-app, sin cambios tras el aprovisionamiento.
- Solo se revocaron privilegios `PUBLIC` en la **nueva** base/esquema de Ritmo. No se cambiaron las ACLs de date-app/calle.

Compartir proyecto implica compartir cómputo, administración y límites. Los administradores existentes mantienen sus privilegios; separar bases y usuarios no impide a un administrador acceder. Si se requiere esa separación, usar proyectos independientes.

## Publicar sin exponer secretos

En Vercel configura **solo**:

1. `DATABASE_URL`: la conexión del rol de aplicación del `.env` de Ritmo.
2. `BETTER_AUTH_SECRET`: el secreto propio de Ritmo ya generado.
3. `APP_ORIGIN`: el dominio HTTPS exacto de producción, sin barra final. El local permanece en `http://127.0.0.1:5173`.
4. `PG_POOL_MAX=3`.

**Nunca** subas `MIGRATION_DATABASE_URL`, el `.env` completo ni credenciales de date-app. No pegues los valores en el chat. No uses prefijos `VITE_`.

Importa la raíz completa del proyecto: preset Vite, Node 22, build `npm run build`, salida `dist`. Las migraciones ya se aplicaron; no se ejecutan desde el build o por petición. Instrucciones completas en el README.

El comando de instalación está fijado en `vercel.json` como `npm ci --include=dev`: las herramientas de compilación también se necesitan en el build de producción. Las definiciones `@types/node` y `@types/pg` se incluyen además en `dependencies` para que sigan disponibles al compilar las funciones con dependencias de producción. Si aparece `TS2688` al desplegar una revisión antigua, publica los cambios de `package.json`, `package-lock.json` y `vercel.json` y reintenta sin reutilizar la caché de build.

## Herramientas del responsable

- `npm run db:migrate`: aplica migraciones y ajusta CRUD del runtime; no imprime secretos.
- `npm run db:cleanup`: elimina únicamente registros caducados.
- `npm run neon:verify -- --allow-test-writes`: prueba remota explícita con cuentas ficticias temporales. Último informe en `docs/neon-verification.json`, sin secretos. No es un despliegue Vercel ni una validación de HealthKit.
- `npm run check`: pruebas locales aisladas; no usa Neon, incluso con el `.env` real presente.

`neon:setup` es una herramienta de operador que requiere `--source-env PATH --apply`. **Ya se ejecutó con autorización y no es necesaria para arrancar la app.** Se limita a la base/roles de Ritmo; ante nombres ajenos o discrepancias se detiene sin rotar ni borrar recursos existentes. No borrar el `.env` para reintentarlo: contiene las credenciales propias necesarias para reanudar una operación parcial.

## Actualización v1: pasos personales

`002_simple_steps.sql` ya está aplicada en fitness_challenge; no es necesario volver a crear la base. Runtime tiene CRUD en `personal_steps` y `legacy_step_archive`, sin CREATE de esquema ni permisos administrativos. El nuevo código todavía debe publicarse en Vercel. Se conservó BETTER_AUTH_SECRET existente. Historial previo se conserva canónicamente (sin sumar retos solapados) y se archiva antes de cascadas por salida/eliminación de retos. El borrado de todos los datos propios elimina también ese archivo.

Nuevo flujo: POST `/api/steps` con `{userCode,steps}`, sin Authorization; perfil privado contiene código y zona. Los endpoints legacy continúan disponibles. Ver README y VERIFICATION.md para el estado final; el informe neon-verification.json anterior es histórico.

## Cierre de retos (003, aplicado)

El31 de octubre de2026 se aplicó003_challenge_results.sql y se repitió sin cambios. Se agregan prize_rule y result a challenges, e historial personal_step_history para elegir el snapshot recibido antes del corte real. Se copian internamente los últimos snapshots existentes; no se inventan versiones antiguas perdidas. Datos históricos insuficientes producen resultado incompleto, no un ganador supuesto.

El rol runtime conserva CRUD, ahora en14tablas, y USAGE/SELECT de secuencia del historial; catálogo confirmó sin CREATE de esquema. Sin cambios de secretos, DNS, variables remotas ni otras bases del proyecto compartido. No se consultaron o exportaron actividades reales mediante herramientas de QA. No editar001,002 ni003 después de aplicadas.
