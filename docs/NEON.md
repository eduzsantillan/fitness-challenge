# Neon conectado a Ritmo

## Estado actual

- Base propia: **`fitness_challenge`**, en el mismo entorno Neon que ya contiene `noemi` (date-app) y `calle`.
- Migración `001_initial.sql` aplicada: tablas de acceso, retos, actividad y claves.
- Configuración local guardada en `.env`, ignorada por Git y Vercel, permisos `0600`.
- Registro, cookies de sesión, invitaciones, dos participantes, actividad manual, envíos de Atajos, persistencia, deduplicación y revocación comprobados contra Neon real.
- Las cuentas/actividad ficticias de verificación se eliminaron. No se importaron registros de date-app o calle.
- **Despliegue del usuario:** `https://ritmo.eduzsantillan.com`. Comprobación GET del 31 de octubre de 2026: `/api/status` y `/api/session` devuelven JSON HTTP 503 con `configured: false`. La API está publicada pero no confirmó su configuración. Revisar variables de Production y usar `APP_ORIGIN=https://ritmo.eduzsantillan.com` sin barra final antes de redesplegar; este aviso no requiere crear otra base.
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
