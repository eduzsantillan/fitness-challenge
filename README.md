# Ritmo

**Un reto. Tu gente. Y a caminar.** PWA privada para competir con pasos, con frontend React/Vite y API Vercel en el mismo dominio; PostgreSQL en Neon y sesiones Better Auth.

## La experiencia v1

Solo dos destinos:

- **Mis retos:** crear un reto con nombre, duración (1–31 días) y premio de texto. El creador queda dentro automáticamente. Comparte un enlace; la otra persona entra, ve la invitación y pulsa **Unirme al reto**. Clasificación privada por pasos y seis frases por escenario (en cabeza, detrás, empate, sin datos, recta final…).
- **Mi perfil:** código privado para Atajos y pasos personales por día, semana (lunes a domingo) o mes natural. El historial no se suma por reto. Cero es un dato; «—» significa que falta recibirlo.

UI minimalista: pasos y premio al frente, tipografía ampliada y opciones secundarias bajo demanda. Perfil abre el día actual; el código está en **Mi perfil → Atajos y código**.

UI mobile-first con navegación inferior, áreas seguras, campos de 16 px, gestos del navegador, estados vacíos y movimiento reducido. La demo es explícita, ficticia y solo vive en memoria; nunca sustituye silenciosamente datos reales que fallaron. Sin dashboard ni controles de entrenamiento en esta versión.

## Cuando termina un reto

- El último día cuenta completo, hasta la medianoche siguiente en la zona del reto (incluido cambio de horario).
- En **Terminados → Ver resultado y premio** queda la foto final, con una celebración breve, clasificación, premio pendiente/recibido y una revancha opcional. La animación no bloquea la pantalla y respeta movimiento reducido.
- El servidor congela el resultado con los snapshots recibidos antes del corte. Un envío posterior actualiza el perfil, no cambia quién ganó. El historial de versiones permite reconstruir el corte aunque otro huso siga en el día anterior. El cierre se materializa al consultar el resultado; no requiere cron ni que alguien tenga abierta la app a medianoche.
- Al crear se acuerda quién entrega **un solo premio**: quienes no ganan entre todos, el creador, o coordinación libre. La invitación muestra la regla antes de aceptar. Los retos anteriores quedan por coordinar; no se les inventan deudas.
- Solo el ganador individual puede confirmar **Ya recibí mi premio**, con confirmación e idempotencia. Es seguimiento social: Ritmo no cobra, transfiere dinero ni entrega premios.
- Empate positivo comparte primer puesto; sin datos de algún participante, todos en cero o una sola persona no se asigna premio automáticamente. No se declara que los pasos recibidos sean toda la actividad real del grupo.
- Al retirar datos, se anonimiza la identidad y actividad congelada, sin reasignar la victoria a otra persona. El borrado de cuenta/datos también elimina su historial interno de snapshots.

## Envío simple de Atajos

```http
POST https://ritmo.eduzsantillan.com/api/steps
```

```json
{"userCode":"TU_CODIGO_PRIVADO_DE_MI_PERFIL","steps":90}
```

- **Solo** esos dos campos; `steps` es un número entero entre 0 y 250000.
- Sin `Authorization`, cookies, `date`, `timeZone`, `capturedAt` ni ID de reto.
- Sin cabeceras manuales: este endpoint acepta un objeto JSON válido aunque no haya Content-Type explícito. No acepta consultas GET para escribir.
- La app detecta la zona IANA del navegador al preparar un perfil sin zona. Se conserva; no cambia silenciosamente cada vez que se inicia sesión.
- El servidor calcula **el día de recepción** en esa zona y reemplaza el snapshot personal de ese día. No suma reintentos ni permite importar otros días por este endpoint.
- El código es una **capacidad privada de escritura**, no el ID público del participante. Quien lo tenga puede actualizar pasos. No permite entrar, leer perfiles ni clasificaciones. Perfil lo muestra oculto y permite copiar/renovar; nunca lo publiques en URL, logs ni plantilla de Atajos compartida.
- Pasos personales se reflejan en retos según sus fechas y fecha local de ingreso. Entre zonas distintas se comparan fechas locales individuales, no ventanas UTC idénticas. Para el mismo corte diario de Salud, los participantes deben usar la misma zona.

Respuesta correcta: `{ "accepted": 1, "date": "2026-10-31", "syncedAt": "…" }`.

[Guía nueva de Atajos](docs/ATAJOS.md). El endpoint anterior `/api/shortcuts`, claves por reto, Authorization y datos de entrenamiento **siguen en código y pruebas** para compatibilidad; la nueva UI no los utiliza. Guía histórica: [ATAJOS-LEGACY.md](docs/ATAJOS-LEGACY.md).

## Desarrollo local

Node.js 22 y npm:

```bash
npm ci --include=dev
cp .env.example .env
# Configurar credenciales propias solo en .env; no subirlo.
npm run db:migrate
npm run dev
```

`npm run dev` inicia frontend en `http://127.0.0.1:5173` y API real en `127.0.0.1:3001`. No hay identidad ficticia ni bypass de autenticación local. `dev:web` y `preview` solos no sustituyen la API.

Para una vista con cuentas y datos ficticios en una base PostgreSQL **desechable**, sin usar Neon:

```bash
node scripts/test-postgres.mjs --preview
```

Requiere `initdb` y `pg_ctl` locales (o `PG_BIN`). Detenerlo elimina todo el entorno de prueba. No lo uses para guardar información real.

## Neon y despliegue Vercel

Base dedicada existente: `fitness_challenge`, en el entorno Neon compartido del usuario. La app usa su rol `fitness_challenge_app`, sin DDL; migraciones con `fitness_challenge_migrator`, exclusivamente local. No se modifican `noemi` ni `calle`.

**Esquema hasta `003_challenge_results.sql` aplicado a Neon el 31 de octubre de 2026**, con `npm run db:migrate` e idempotencia comprobada. En una instalación nueva, ejecutar ese comando antes del despliegue. Las migraciones son aditivas y conservan contratos anteriores;003 añade resultado, regla del premio e historial de snapshots. No editar `001`, `002` ni `003` ya aplicadas (tienen checksum). No migrar dentro del build o en cada petición.

Publicar la raíz completa del repositorio, no solo `dist`:

| Ajuste | Valor |
| --- | --- |
| Framework | Vite |
| Node | 22.x |
| Install | `npm ci --include=dev` (en vercel.json) |
| Build | `npm run build` |
| Output | `dist` |

Variables privadas de **Production**:

- `DATABASE_URL`: únicamente rol runtime de Ritmo.
- `BETTER_AUTH_SECRET`: conservar el secreto ya existente. Cambiarlo invalida sesiones y exige reparar/reemitir códigos.
- `APP_ORIGIN=https://ritmo.eduzsantillan.com` sin barra final.
- `PG_POOL_MAX=3`.

**Nunca** subir `MIGRATION_DATABASE_URL`, credenciales administrativas de date-app ni `.env` completo. `.env*` está excluido de Git y Vercel; `.env.example` solo contiene placeholders. Ningún secreto usa prefijo `VITE_`. Previews no deben compartir datos/códigos de producción.

Entrada fija `api/index.ts`; rewrite explícita `/api/(.*) → /api` antes de la SPA. No confiar en catchall estilo Next con un proyecto Vite. API y sesión responden no-store y jamás se cachean en el service worker.

Después del despliegue, comprobar `/api/status` y un registro real: `configured:true` por sí solo no certifica todas las tablas, cookies ni escrituras. Probar desde iPhone físico sigue siendo necesario; la prueba responsive en escritorio no lo sustituye.

## Endpoints principales

| Método/ruta (`/api`) | Acceso |
| --- | --- |
| POST `/steps` | Solo código privado en JSON; sin Authorization |
| GET `/me`, PUT `/me` | Sesión propia, nombre/zona |
| POST `/me/code` | Sesión propia; revoca código anterior |
| GET `/me/activity` | Historial personal; sesión propia |
| GET/POST `/challenges` | Sesión; creación incluye automáticamente al autor |
| GET `/challenges/:id/leaderboard` | Solo miembros |
| POST `/challenges/:id/invites` | Solo creador; mientras el reto está abierto |
| POST `/challenges/:id/prize-receipt` | Solo ganador individual; confirma recibido idempotentemente |
| GET `/invites/:token` | Sesión; preview sin códigos ni actividad |
| POST `/join` | Sesión + aceptación explícita para compartir pasos |
| DELETE `/challenges/:id/membership` | Miembro; dueño elimina reto |
| DELETE `/me/data` | Sesión y confirmación; borra historial/código/datos de app |

Sesiones con cookies HttpOnly, Secure en HTTPS, SameSite Lax y validación exacta de origen. El receptor público de pasos tiene payload pequeño, validación estricta, rate limit por IP/código y comprobación atómica de código al escribir para impedir uso tardío tras revocación. La información del perfil/código jamás viaja en rankings ni invitaciones.

## Pruebas

```bash
npm run check
npm audit
```

Incluye typechecks, unitarias, PostgreSQL real desechable, smoke HTTP, build/PWA y verificador de despliegue/secretos. Las pruebas fuerzan `MIGRATION_DATABASE_URL=''` para que la carga del `.env` no reintroduzca una conexión remota. Ver [VERIFICATION.md](docs/VERIFICATION.md).

La herramienta `neon:verify -- --allow-test-writes` es opt-in y escribe/elimina únicamente fixtures propios en la base dedicada; nunca se ejecuta durante build. El aprovisionador `neon:setup` ya se utilizó y no es necesario para iniciar o desplegar.

## Límites del piloto

- Email/contraseña con mínimo 12 caracteres. Sin verificación ni recuperación de correo todavía: no habilitar registro público masivo antes de añadir esos flujos.
- No lectura directa de Salud desde la PWA ni garantía de ejecución cada diez minutos, teléfono bloqueado o sin red. No hay cola offline. El usuario confirmó un envío desde iPhone a `/api/steps`; aún deben validarse fuentes, automatizaciones y otros contextos de red.
- Solo pasos en UI; no se certifica origen Watch ni antifraude. Validar fuentes para no contar el mismo paseo dos veces.
- Salir/eliminar un reto conserva historial personal; borrar datos de app revoca código y elimina historial, pero conserva cuenta de acceso (nombre/email/password). El borrado completo de cuenta requiere al responsable verificado del piloto.
- No publicidad ni analítica de terceros. Antes de invitar públicamente: contacto, privacidad, retención y flujo de baja. La retención de copias Neon depende del plan y debe documentarse por el responsable.
