# Prompt para OpenCode: desplegar Truco Backend en un Droplet

Copiá y pegá todo el bloque de la sección "Prompt operativo" en OpenCode dentro del Droplet.

## Prompt operativo

Actuá como ingeniero DevOps senior y configurá el backend de Truco Argentino en este Droplet. Trabajá de forma segura, documentá cada decisión y no destruyas datos ni servicios existentes.

### Objetivo

Dejar funcionando el backend completo con:

- API HTTP Express/TypeScript.
- Socket.IO para tiempo real, incluyendo WebSocket y polling.
- Worker de BullMQ.
- PostgreSQL persistente.
- Redis persistente.
- Migraciones Drizzle antes de iniciar la API.
- Reinicio automático mediante Docker Compose.
- Una sesión tmux llamada "truco-backend".
- Un informe final dentro del repositorio.

El repositorio oficial es:

~~~text
https://github.com/GabrielCuello23/truco-backend.git
~~~

### Datos del entorno ya configurados

El propietario ya compró el dominio en Cloudflare Registrar y configuró el DNS para la API. No vuelvas a comprar dominios ni cambies nameservers sin necesidad.

Datos esperados del entorno:

~~~text
Dominio principal: trucoargentino.app
Hostname público de la API: api.trucoargentino.app
IPv4 pública del Droplet: 146.190.210.144
IPv6 pública del Droplet: 2604:a880:400:d1:0:5:3a6:a001
Registro DNS A esperado: api -> 146.190.210.144
Registro DNS AAAA esperado: api -> 2604:a880:400:d1:0:5:3a6:a001
URL final esperada de la API: https://api.trucoargentino.app
URL final esperada para Expo: https://api.trucoargentino.app/api/v1
~~~

Verificá que los registros realmente existan y apunten a esas IP antes de continuar. Si no coinciden, no los reemplaces silenciosamente: informá la diferencia y pedí confirmación.

El dominio usa Cloudflare Registrar y debe conservar los nameservers de Cloudflare. El dominio .app requiere HTTPS. Verificá también que el email del registrante de Cloudflare esté validado.

El propietario ya configuró el firewall del servidor y el Cloud Firewall de DigitalOcean:

- UFW está activo.
- UFW permite SSH TCP 22 con límite, HTTP TCP 80 y HTTPS TCP 443, tanto para IPv4 como para IPv6.
- El Cloud Firewall de DigitalOcean está aplicado al Droplet.
- Sus reglas entrantes esperadas son TCP 22, TCP 80 y TCP 443 desde All IPv4 y All IPv6.
- Sus reglas salientes predeterminadas permiten ICMP, TCP y UDP.
- Los puertos 3000, 5432 y 6379 no deben abrirse públicamente.

Verificá estas condiciones sin borrar ni recrear reglas existentes. Si falta una regla, agregala sólo cuando sea necesario y documentá el cambio.

### Reglas de seguridad

Antes de modificar algo:

1. Detectá sistema operativo, arquitectura, usuario, memoria, disco, IP pública y privada, Docker, Docker Compose, Git, tmux, ufw y puertos ocupados.
2. Revisá servicios, contenedores, bases de datos y directorios existentes. No sobrescribas ni elimines nada sin confirmación.
3. No ejecutes rm -rf, docker system prune, docker volume prune, git reset --hard ni comandos destructivos equivalentes.
4. No expongas secretos en la salida, en Git, en logs ni en el informe.
5. No guardes contraseñas, JWT secrets, tokens, DSN privados ni claves SSH en el informe.
6. No hagas git push ni cambies el repositorio remoto.
7. Si falta un dominio, no inventes uno. Prepará una alternativa temporal y documentá la limitación.

### Clonado

Usá un directorio persistente dentro del home del usuario de despliegue, preferentemente:

~~~text
$HOME/truco-backend
~~~

Si no existe:

~~~bash
git clone https://github.com/GabrielCuello23/truco-backend.git "$HOME/truco-backend"
~~~

Si ya existe, inspeccioná remoto, rama, commit y cambios locales. No lo reemplaces automáticamente. Verificá que el remoto sea exactamente el indicado.

Analizá antes de modificar:

- package.json y package-lock.json.
- Dockerfile, docker-compose.yml y .env.example.
- src/config/env.ts, src/server.ts, src/worker.ts y src/app.ts.
- src/database/, drizzle/, src/realtime/, src/jobs/ y src/observability/.
- src/modules/auth/, src/modules/rooms/ y src/modules/games/.
- README.md y docs/.

No supongas que el clon remoto coincide con otra copia local.

### Arquitectura que debes verificar

Confirmá y documentá:

- API: src/server.ts, compilada a dist/server.js.
- Worker: src/worker.ts, compilado a dist/worker.js.
- Migraciones: npm run db:migrate.
- Build: npm run build.
- Health live: /health/live.
- Health readiness: /health/ready.
- API versionada: /api/v1.
- Métricas: /metrics.
- Socket.IO sobre el mismo puerto HTTP.

Verificá que:

- Las migraciones coincidan con src/database/schema.ts.
- Los servicios dentro de Compose usen postgres:5432 y redis:6379, no localhost.
- NODE_ENV=production use un JWT_SECRET real.
- API y worker usen el mismo Redis.
- Socket.IO soporte proxy inverso y WebSocket.
- No haya secretos versionados.
- El endpoint /metrics no quede públicamente expuesto sin protección.

### Producción

No reemplaces el Compose de desarrollo. Creá, salvo que ya exista una alternativa equivalente:

~~~text
docker-compose.production.yml
~~~

El Compose de producción debe:

- Usar el target production del Dockerfile para API y worker.
- Ejecutar npm run db:migrate en un servicio de migración de una sola ejecución.
- Iniciar API y worker después de PostgreSQL, Redis y migraciones exitosas.
- Usar restart: unless-stopped para servicios persistentes y de aplicación.
- Persistir PostgreSQL y Redis en volúmenes Docker.
- No montar el código fuente del host dentro de los contenedores.
- No usar tsx watch ni comandos de desarrollo.
- No publicar PostgreSQL ni Redis a Internet.
- Publicar la API sólo por el puerto necesario.
- Configurar límites de logs Docker.
- Mantener healthchecks.
- Permitir WebSocket y polling de Socket.IO.

Usá un archivo de entorno sólo en el servidor:

~~~text
.env.production
~~~

Generá valores criptográficamente seguros para JWT_SECRET y POSTGRES_PASSWORD. Configurá como mínimo:

~~~env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://<usuario>:<password>@postgres:5432/truco
REDIS_URL=redis://redis:6379
JWT_SECRET=<secreto-generado>
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=180
CORS_ORIGINS=<orígenes-permitidos>
LOG_LEVEL=info
SENTRY_DSN=
OTEL_ENABLED=false
OTEL_SERVICE_NAME=truco-backend
DB_POOL_MAX=<valor-compatible-con-la-memoria>
~~~

Usá permisos 600 para el archivo y nunca muestres sus valores. No uses secretos de desarrollo ni credenciales hardcodeadas.

### Dominio, TLS y acceso público

Configurá el backend específicamente para:

~~~text
api.trucoargentino.app
~~~

No uses la IP como URL final de la aplicación.

- Verificá los registros A y AAAA de api.trucoargentino.app.
- Configurá Caddy como reverse proxy, salvo que exista una razón técnica documentada para usar Nginx.
- Emití un certificado público válido para api.trucoargentino.app.
- Redirigí HTTP a HTTPS.
- Soportá WebSocket y polling de Socket.IO.
- Enviá el tráfico del proxy a la API Docker en el puerto interno 3000.
- Ocultá o protegé /metrics.
- Configurá CORS_ORIGINS con los orígenes reales y explícitos.
- No habilites el modo Cloudflare Flexible.
- Después de que el certificado del origen funcione, configurá o verificá Cloudflare SSL/TLS en Full (strict).
- Si Cloudflare usa proxy naranja, asegurate de que el origen siga aceptando HTTPS por 443.

Si Cloudflare está en DNS-only durante la emisión del certificado, podés mantenerlo así temporalmente y documentar cuándo conviene activar el proxy. No cambies el proxy status sin verificar el efecto sobre Caddy.

### Firewall

Inspeccioná reglas existentes sin borrarlas. El propietario ya agregó las reglas de firewall indicadas en la sección de datos del entorno. Verificá:

- SSH TCP 22 permitido para IPv4 e IPv6.
- HTTP TCP 80 permitido para IPv4 e IPv6.
- HTTPS TCP 443 permitido para IPv4 e IPv6.
- Puerto 3000 no expuesto públicamente salvo que exista una decisión explícita y documentada.
- PostgreSQL y Redis no accesibles públicamente.
- UFW y Cloud Firewall no tengan reglas contradictorias.

Si modificás UFW o el Cloud Firewall, documentá las reglas exactas y no elimines la regla SSH.

### Build, migraciones y validación

Ejecutá de forma controlada, adaptando los nombres si el Compose final difiere:

~~~bash
docker compose -f docker-compose.production.yml config
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml run --rm migrate npm run db:migrate
docker compose -f docker-compose.production.yml up -d
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs --tail=200 api
docker compose -f docker-compose.production.yml logs --tail=200 worker
curl -fsS http://127.0.0.1:3000/health/live
curl -fsS http://127.0.0.1:3000/health/ready
~~~

Ejecutá también, cuando sea compatible:

~~~bash
npm run typecheck
npm run lint
npm test
npm run format:check
npm run build
~~~

Si algo falla, investigá la causa y reportala. No ocultes fallos ni afirmes que algo fue validado si no lo verificaste.

### Backups y operación

Prepará, si es viable, un backup PostgreSQL con pg_dump, retención razonable y destino fuera del volumen principal. No borres backups existentes.

Documentá estos comandos:

~~~bash
tmux attach -t truco-backend
tmux detach-client
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs -f api worker
docker compose -f docker-compose.production.yml restart api worker
docker compose -f docker-compose.production.yml down
~~~

No ejecutes docker compose down -v en producción.

### tmux

Creá una sesión persistente llamada exactamente "truco-backend". Docker debe supervisar los contenedores; tmux se usará para la sesión operativa y los logs.

Si el stack ya está levantado:

~~~bash
tmux new-session -d -s truco-backend \
  "cd $HOME/truco-backend && docker compose -f docker-compose.production.yml logs -f --tail=100 api worker"
~~~

Si la sesión ya existe, inspeccionala y no la mates automáticamente. Verificá:

~~~bash
tmux has-session -t truco-backend
~~~

### Informe obligatorio

Creá dentro del repositorio clonado:

~~~text
DEPLOYMENT_REPORT.md
~~~

Escribilo en español e incluí:

1. Fecha y hora.
2. Host, sistema operativo, arquitectura y usuario, sin datos sensibles.
3. Commit desplegado y remoto Git.
4. Ruta absoluta del repositorio.
5. Archivos creados o modificados.
6. Arquitectura final de API, worker, PostgreSQL, Redis, migraciones y proxy.
7. Comandos relevantes, sin secretos.
8. Nombres de variables configuradas, nunca sus valores secretos.
9. Estado final de cada contenedor.
10. Resultado de /health/live y /health/ready.
11. Resultado de typecheck, lint, tests y build.
12. Puertos públicos e internos.
13. Cambios de firewall.
14. Volúmenes y estrategia de backup.
15. Sesión tmux y comandos de operación.
16. URL final de API, indicando si usa HTTPS o HTTP temporal.
17. Problemas, riesgos pendientes y próximos pasos.

No incluyas secretos, tokens, contraseñas ni el contenido completo de .env.production.

### Criterio de finalización

Terminá sólo cuando:

- El repositorio correcto esté clonado y verificado.
- API, worker, PostgreSQL y Redis estén operativos.
- Las migraciones estén aplicadas.
- Los health checks respondan correctamente.
- Socket.IO esté preparado para el proxy o la limitación esté documentada.
- Los secretos estén fuera de Git y tengan permisos seguros.
- Firewall y puertos estén revisados.
- Exista la sesión tmux "truco-backend".
- Exista DEPLOYMENT_REPORT.md dentro del repositorio.

Al finalizar, mostrámelo en un resumen breve y señalá la ruta exacta del informe sin mostrar secretos.

## Análisis del backend actual

El backend contiene API Express, autenticación JWT/Argon2, PostgreSQL con Drizzle, Redis, Socket.IO, worker BullMQ, motor de juego de Truco, health checks, métricas, Sentry opcional y OpenTelemetry opcional.

El docker-compose.yml actual está orientado a desarrollo: usa tsx watch, bind mounts, secretos de desarrollo y publica PostgreSQL/Redis en el host. El Dockerfile ya tiene targets development, build y production; el despliegue debe aprovechar production en un Compose separado.

El repositorio contiene migraciones Drizzle, tests del motor y tests de health. El despliegue debe verificar que el esquema remoto esté alineado con las migraciones antes de aceptar tráfico.

Antes de cerrar el trabajo, verificá y dejá documentados estos puntos del código actual:

- El worker consume la cola game-events, pero no asumas que toda la lógica de outbox o publicación está implementada sin comprobarlo.
- Las jugadas del bot usan timers dentro del proceso de la API; documentá el impacto de reinicios y si hace falta una solución persistente.
- Socket.IO usa el adaptador Redis, mientras que realtimeEvents es un EventEmitter local al proceso; verificá qué eventos funcionan entre varias instancias.
- /metrics está implementado como endpoint HTTP; protegelo o restringilo en producción.
- CORS_ORIGINS tiene valores locales por defecto; configurá valores explícitos para el entorno real.
- El Compose de desarrollo publica PostgreSQL en 5433 y Redis en 6380, pero producción debe mantenerlos internos.
- El guard de producción de src/config/env.ts rechaza el JWT_SECRET de desarrollo; verificá que el secreto generado lo satisfaga.

No incluyas secretos reales en este archivo ni en DEPLOYMENT_REPORT.md.
