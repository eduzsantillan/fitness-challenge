# Verificación de la migración Vercel + Neon

## Comprobado localmente

- Ambos typechecks (API/backend y React).
- 36 tests unitarios: permisos, consentimiento, fechas, snapshots, caducidad/rotación/revocación, límites HTTP/CSRF, cookies en cliente, configuración TLS, separación de conexión de migración y caché PWA (incluida actualización de la guía sin cambiar HTML).
- 12 tests de integración en **PostgreSQL real desechable**: esquema compatible con Better Auth instalado, registro y password hash, cookies HttpOnly/Secure, identidad por sesión, exclusión de tokens JSON, claves scopeadas, invitaciones, membresías, nombres, UPSERT, preservación de entrenamiento, claves concurrentes, expiración, carrera revocación/escritura, cascadas, rate limiting atómico, cierre de sesión y registro con usuario no propietario sin DDL.
- Smoke HTTP contra el servidor local real, con dos usuarios registrados y cookies, sin identidades especiales de desarrollo. Persistencia en PostgreSQL, invitaciones, envío de Atajos sin cookie, deduplicación, aislamiento y revocación.
- Build frontend/PWA y empaquetado local de entrada Vercel, configuración SPA que excluye API, CSP mismo origen, sin dependencias AWS.
- Navegador local: crear cuenta ficticia, crear reto, guardar actividad ficticia, recargar, generar clave enmascarada, cerrar sesión y volver a entrar recuperando datos. Sin errores/warnings de consola. Formulario comprobado a 395 píxeles CSS de ancho sin overflow; no equivale a una prueba en iPhone físico.
- `npm audit`: sin vulnerabilidades reportadas en dependencias instaladas. Capturas de prueba en `docs/preview-login.jpg`, `docs/preview-connect.jpg` y `docs/preview.jpg`.

## Comprobado contra Neon real

- Base `fitness_challenge` creada con autorización en el entorno compartido. Roles SQL propios para runtime y migración; sin privilegios administrativos.
- Migraciones aplicadas y configuración privada local `0600`. Runtime sin DDL, TRUNCATE ni edición de historial de migraciones.
- Flujo de API con dos cuentas ficticias contra Neon: registro y sesiones HttpOnly, membresía privada, invitación, actividad, clave Atajos, deduplicación, preservación de entrenamiento, persistencia desde otro runtime y revocación/logout. Cuentas y registros de prueba eliminados de forma selectiva.
- Runtime sin permisos de tablas ni creación en esquemas `public` de `noemi`/`calle`. Solo consultas de catálogos en otras bases; sin modificaciones de sus datos o ACLs. Configuración de date-app intacta.
- Informe sin secretos: `docs/neon-verification.json`. Credenciales de migración no deben subirse a Vercel.

## Pendiente en el despliegue real

1. La base Neon y las migraciones **ya están listas**. Falta configurar las variables privadas en Vercel usando únicamente el rol de runtime, nunca la conexión de migraciones.
2. Publicar proyecto completo en Vercel, con su dominio y APP_ORIGIN exacto, y comprobar funciones y cookies en HTTPS del despliegue real.
3. Probar flujo entre dos iPhones/cuentas, invitaciones y revocación contra el dominio público.
4. Validar Find Health Samples, permisos, fuentes y total de pasos en el iPhone del usuario. No se ha demostrado lectura automática correcta todavía; una captura previa mostraba Log Health Sample (escritura), no Find (lectura).
5. Probar instalación Safari/PWA, teclado y comportamiento en dispositivo físico. La duración de entrenamientos permanece manual.
6. Antes de registro público, configurar verificación y recuperación de email (no implementadas en este piloto), revisar abuso y publicar política/contacto/conservación/baja.

No se crearon nuevas cuentas/proyectos Neon, no se publicó Vercel ni se modificó DNS. La conexión administrativa existente de date-app se usó solo para aprovisionar los nuevos recursos autorizados, nunca como credencial de la app ni copiada a Ritmo. Las pruebas no certifican el flujo completo de Salud ni garantizan ejecución periódica con iPhone bloqueado.
