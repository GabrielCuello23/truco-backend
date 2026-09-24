# Reglas de desarrollo

Este archivo es el contrato para agregar endpoints, funcionalidades, eventos y módulos al backend. Antes de modificar código, leer `docs/STACK.md` y este documento. Mantener estas reglas evita que la lógica termine duplicada entre Express, Socket.IO y el frontend.

## Regla principal

Cada funcionalidad debe tener una única fuente de verdad en un módulo de dominio o aplicación. Los controllers HTTP y los handlers de Socket.IO solo deben:

1. Validar entrada.
2. Obtener identidad y contexto.
3. Invocar un caso de uso.
4. Traducir el resultado a HTTP o a un evento.

No colocar reglas de negocio, consultas complejas ni transacciones largas dentro de una ruta.

## Estructura de un módulo

Crear módulos en `src/modules/<feature>`:

```text
src/modules/<feature>/
  <feature>.routes.ts       # REST y validación de transporte
  <feature>.schemas.ts      # Schemas Zod reutilizables
  <feature>.service.ts      # Casos de uso y transacciones
  <feature>.repository.ts   # Consultas SQL/Drizzle específicas, si hacen falta
  <feature>.types.ts        # Tipos públicos del módulo, si hacen falta
  <feature>.test.ts         # Tests unitarios del caso de uso
```

No crear archivos genéricos como `utils.ts`, `helpers.ts` o `services.ts` sin una razón concreta. El nombre debe explicar el dominio.

## Agregar un endpoint REST

Usar este procedimiento:

1. Definir el recurso y decidir si necesita autenticación.
2. Crear el schema Zod para body, params y query.
3. Crear o extender un caso de uso en el módulo.
4. Implementar autorización explícita.
5. Usar Drizzle dentro del repository o del caso de uso.
6. Añadir la ruta al router del módulo.
7. Montar el router en `src/app.ts` bajo `/api/v1`.
8. Agregar tests de éxito, validación, autorización, no encontrado y conflicto.
9. Documentar request, response y errores.
10. Ejecutar `npm run typecheck`, `npm run lint`, `npm test` y `npm run format:check`.

Ejemplo de contrato:

```text
POST /api/v1/rooms
Authorization: Bearer <access-token>

Request:
{ "maxPlayers": 4 }

Response 201:
{ "room": { "id": "...", "code": "...", "status": "waiting" } }
```

## Convenciones REST

- URLs en plural y kebab-case: `/room-members`.
- Versionar por path: `/api/v1`.
- Respuestas exitosas con objeto raíz descriptivo: `{ "user": ... }`, `{ "room": ... }`.
- Errores con `{ "error": { "code", "message", "details?" } }`.
- No devolver `passwordHash`, refresh tokens ni datos privados.
- Usar status `201` al crear, `204` al eliminar sin body, `400` para input inválido, `401` sin identidad válida, `403` sin permisos, `404` si no existe y `409` para conflictos.
- No aceptar campos desconocidos como estado del juego sin validar explícitamente.

## Autenticación y autorización

- Usar `requireAuth` para endpoints privados.
- No confiar en un `userId` enviado en el body si existe `request.auth.userId`.
- Verificar pertenencia a sala y partida en cada operación.
- Los roles se comprueban en el backend aunque el frontend oculte botones.
- Los refresh tokens se rotan y se revocan; nunca se guardan en texto plano.
- Las cuentas sociales deben vincularse en `auth_accounts`; no crear un segundo `users` para el mismo jugador.
- Google y Apple deben identificarse por su `provider_account_id`; el email externo solo sirve como atributo de perfil.
- Errores de login no deben revelar si existe un email.

## Modificaciones de base de datos

1. Cambiar `src/database/schema.ts`.
2. Ejecutar `npm run db:generate`.
3. Revisar manualmente el SQL generado.
4. Probar con una base local limpia y una base con datos.
5. Ejecutar `npm run db:migrate`.
6. Incluir la migración en el mismo cambio de código.

Usar migraciones expand/contract para cambios incompatibles. No borrar columnas ni renombrar datos en un único deploy si todavía existen instancias antiguas.

Toda restricción importante debe vivir también en PostgreSQL: unique indexes, foreign keys, not null y checks cuando corresponda.

## Reglas para partidas

- El motor de reglas debe ser una función o servicio puro y testeable.
- El cliente envía comandos, nunca un estado nuevo.
- Cada comando lleva `commandId` e `expectedVersion`.
- Un comando repetido debe ser idempotente.
- La partida se serializa con row lock o control optimista en PostgreSQL.
- El resultado debe registrar snapshot, versión, evento e outbox en la misma transacción.
- Los eventos públicos y privados deben separarse.
- Nunca transmitir la mano de un jugador a toda la room.
- Los temporizadores del turno deben validarse en servidor; el reloj del cliente solo es visual.
- Desconexión y reconexión deben recuperar snapshot y eventos faltantes.

## Reglas para Socket.IO

- Eventos de comandos usan nombres como `game:command` y acknowledgement `{ ok, error? }`.
- Eventos de estado usan nombres como `game:state` o `game:event`.
- Validar todos los payloads con Zod.
- Autenticar el handshake y autorizar cada `room:join` y comando.
- Usar rooms con prefijos: `room:<roomId>` y `game:<gameId>`.
- No guardar el estado crítico en `socket.data`.
- Limitar el tamaño de mensajes y aplicar rate limiting a comandos sensibles.
- El cliente debe tolerar duplicados y eventos fuera de orden usando `version`.

## Testing obligatorio

Cada caso de uso nuevo debe incluir:

- Test del camino exitoso.
- Test de input inválido.
- Test de autenticación y autorización.
- Test de recurso inexistente.
- Test de conflicto o idempotencia si modifica datos.
- Test de concurrencia si modifica una partida.

Para el motor del juego, agregar casos de borde y tests de propiedades con `fast-check`. Para PostgreSQL/Redis, preferir Testcontainers en integración en lugar de mocks que oculten problemas de SQL.

## Manejo de errores y logs

- Lanzar `AppError` para errores esperados.
- No devolver stack traces en producción.
- El mensaje al cliente debe ser seguro y estable; usar `error.code` para lógica del frontend.
- Loggear contexto útil: request ID, user ID, room ID, game ID, command ID y duración.
- Nunca loggear contraseñas, tokens, payloads privados ni cartas ocultas.

## Checklist antes de terminar un cambio

- [ ] Se leyó `docs/STACK.md`.
- [ ] La lógica está en el módulo correcto.
- [ ] Los inputs tienen schema Zod.
- [ ] La autorización está implementada en backend.
- [ ] La persistencia tiene migración revisada.
- [ ] Las operaciones críticas son transaccionales e idempotentes.
- [ ] Hay tests de éxito y fallos relevantes.
- [ ] Se actualizaron README o documentación de API si cambió el contrato.
- [ ] `npm run typecheck` pasa.
- [ ] `npm run lint` pasa.
- [ ] `npm test` pasa.
- [ ] `npm run format:check` pasa.
- [ ] Se inspeccionó `git diff` y no se incluyeron secretos.
