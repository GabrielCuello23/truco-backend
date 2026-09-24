# Stack y arquitectura

Este documento describe las decisiones técnicas del backend de Truco Argentino. El objetivo es tener una base modular, segura y preparada para crecer horizontalmente sin convertir el proyecto en microservicios antes de necesitarlos.

## Principios

- PostgreSQL es la fuente de verdad de usuarios, salas, partidas, eventos y puntuaciones.
- Redis se utiliza para presencia, coordinación, caché, rate limiting y distribución de eventos en tiempo real.
- El cliente nunca decide el estado del juego, las cartas recibidas ni la validez de una jugada.
- Las operaciones que cambian una partida deben ser transaccionales, idempotentes y versionadas.
- REST maneja recursos y operaciones administrativas; Socket.IO maneja eventos en vivo.
- El backend empieza como un monolito modular con un worker separado para tareas asincrónicas.

## Identidad y sesiones

La tabla `users` representa a la persona y `auth_accounts` representa cada forma de autenticación vinculada. El proveedor `password` ya está activo; `google` y `apple` quedan modelados para agregarse más adelante sin crear usuarios duplicados. La identidad externa se relacionará por `provider` y `provider_account_id`, nunca por email como clave principal.

El access token dura poco tiempo y el refresh token se rota dentro de una sesión absoluta de 180 días. La app móvil lo guarda en `expo-secure-store`, lo renueva automáticamente y solo elimina la sesión cuando pasan esos seis meses, es revocada o el usuario pulsa cerrar sesión.

## Tecnologías instaladas

| Tecnología                       | Responsabilidad                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Node.js 20+                      | Runtime del servidor y del worker.                                                                                  |
| TypeScript                       | Tipado estricto, contratos explícitos y menor superficie de errores.                                                |
| Express 5                        | API HTTP, middlewares, routing y manejo de errores.                                                                 |
| Socket.IO                        | Salas WebSocket, reconexión, acknowledgements y eventos en tiempo real.                                             |
| PostgreSQL                       | Persistencia relacional y consistencia transaccional.                                                               |
| Drizzle ORM                      | Esquema tipado, consultas y migraciones sobre PostgreSQL. Se permite SQL explícito para locks y consultas críticas. |
| Redis                            | Presencia efímera, adapter de Socket.IO, rate limiting, caché y coordinación.                                       |
| Redis adapter                    | Propaga eventos de Socket.IO entre varias instancias del backend.                                                   |
| BullMQ + ioredis                 | Colas y workers para tareas que no deben bloquear una request.                                                      |
| Zod                              | Validación de body, params, query string y payloads de Socket.IO.                                                   |
| Argon2                           | Hash seguro de contraseñas.                                                                                         |
| Jose                             | Firma y validación de access tokens JWT.                                                                            |
| Helmet                           | Headers HTTP de seguridad.                                                                                          |
| CORS                             | Permite únicamente orígenes explícitamente configurados.                                                            |
| Express Rate Limit + Redis Store | Límite de requests compartido entre instancias mediante Redis.                                                      |
| Pino + pino-http                 | Logs estructurados y request IDs.                                                                                   |
| Prometheus client                | Métricas HTTP y métricas default del proceso.                                                                       |
| OpenTelemetry                    | Instrumentación y trazas distribuibles cuando `OTEL_ENABLED=true`.                                                  |
| Sentry                           | Captura de errores y trazas de aplicación cuando se configura `SENTRY_DSN`.                                         |
| Vitest                           | Tests unitarios y de integración.                                                                                   |
| Supertest                        | Tests de endpoints HTTP.                                                                                            |
| Testcontainers                   | PostgreSQL y Redis reales para integración.                                                                         |
| fast-check                       | Tests basados en propiedades para reglas del Truco.                                                                 |
| Docker Compose                   | Entorno local reproducible con PostgreSQL, Redis, API y worker.                                                     |

## Componentes

```text
Expo React Native
        |
Cloudflare/WAF/Load Balancer
        |
Express + Socket.IO (una o varias instancias)
        |                 |
PostgreSQL             Redis
        |
Worker BullMQ
```

La app Expo debe usar:

```bash
EXPO_PUBLIC_API_URL=http://IP_LOCAL:3000/api/v1
```

El backend no modifica el frontend existente. La integración de sockets puede agregar `socket.io-client` en la app cuando se implemente la pantalla de salas.

## Persistencia del juego

El esquema inicial contiene:

- `users`: identidad y credenciales.
- `refresh_sessions`: refresh tokens hasheados y revocables.
- `rooms`: sala, código, host, estado y capacidad.
- `room_members`: pertenencia y rol dentro de una sala.
- `games`: snapshot actual y `state_version`.
- `game_events`: historial inmutable de comandos aceptados.
- `outbox_events`: eventos pendientes de publicación luego del commit.

Una jugada debe seguir esta secuencia:

1. Recibir un comando HTTP o Socket.IO.
2. Validar el payload con Zod.
3. Autorizar usuario, sala y partida.
4. Abrir una transacción PostgreSQL.
5. Bloquear la fila de la partida o usar una versión esperada.
6. Ejecutar el motor puro de reglas.
7. Guardar snapshot, incrementar versión y agregar `game_event`.
8. Agregar el evento a `outbox_events` dentro de la misma transacción.
9. Confirmar el commit.
10. Publicar el evento con Socket.IO desde el worker o relay.

El cliente debe descartar eventos repetidos y poder pedir un snapshot cuando se reconecta. Redis no reemplaza este flujo.

## Seguridad

- Todas las entradas se validan con Zod, incluidas las de Socket.IO.
- Las contraseñas se almacenan únicamente con Argon2id.
- Los access tokens duran poco tiempo; los refresh tokens son opacos, aleatorios, hasheados y rotativos.
- La autorización se verifica en cada operación, no solo durante el login o handshake.
- Las cartas privadas se envían solamente al jugador correspondiente.
- El servidor genera y mezcla la baraja usando aleatoriedad criptográfica.
- Se limitan payloads, requests, intentos de login y comandos repetidos.
- No se guardan tokens, contraseñas ni cartas privadas en logs.
- En producción, `JWT_SECRET` y credenciales deben vivir en un secret manager.
- PostgreSQL debe utilizar un usuario con permisos mínimos y backups con PITR.
- El WAF y la protección DDoS deben estar fuera del proceso Node.js.

Si en el futuro se agregan cookies para una aplicación web, habrá que incorporar protección CSRF. La app Expo actual usa Bearer tokens.

## Escalabilidad

La API puede ejecutarse en varias instancias detrás de un load balancer. Socket.IO usa Redis adapter para propagar eventos. Si se conserva polling como transporte, el balanceador debe soportar sticky sessions; si la infraestructura lo permite, se puede priorizar WebSocket.

No se debe usar un lock de Redis como única garantía de integridad de una partida. La consistencia crítica debe resolverse con transacciones y constraints de PostgreSQL. Un modelo single-writer por partida puede agregarse más adelante si las métricas lo justifican.

## Observabilidad

- `/health/live` verifica que el proceso esté vivo.
- `/health/ready` verifica PostgreSQL y Redis.
- `/metrics` expone métricas Prometheus y debe quedar protegido en producción.
- Pino agrega logs estructurados y request IDs.
- Sentry y OpenTelemetry son opt-in mediante variables de entorno.

## Entornos

- Desarrollo: Docker Compose, secretos locales y logs debug.
- Staging: datos aislados, migraciones automáticas controladas y pruebas end-to-end.
- Producción: PostgreSQL/Redis administrados, TLS, WAF, backups, alertas, secrets manager y despliegues graduales.

## Estado actual y próximos módulos

Ya están preparados el runtime, configuración, migraciones Drizzle, autenticación, salas, health checks, métricas, Socket.IO y worker.

El siguiente módulo funcional es `games`: debe contener el motor puro del Truco argentino, el modelo de comandos, las transacciones de `game_events`/`outbox_events`, snapshot de reconexión y eventos privados por jugador. No se debe implementar esa lógica dentro de un controller de Express ni dentro del callback de Socket.IO.
