# Truco Backend

Backend modular para Truco Argentino construido con Node.js, TypeScript, Express, PostgreSQL, Redis y Socket.IO.

## Inicio rápido

Requisitos:

- Node.js 20.19+
- npm 10+
- Docker y Docker Compose

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

La API queda disponible en `http://localhost:3000`.

Compose publica PostgreSQL en `localhost:5433` y Redis en `localhost:6380` para no interferir con otros servicios locales.

```bash
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

Para iniciar PostgreSQL, Redis, la API y el worker:

```bash
docker compose up --build
```

## Comandos

```bash
npm run dev              # API con recarga automática
npm run worker:dev       # Worker con recarga automática
npm run build            # Compilación de producción
npm start                # Ejecuta dist/server.js
npm run typecheck        # Verificación TypeScript
npm run lint             # ESLint
npm run format:check     # Verificación Prettier
npm test                 # Tests
npm run db:generate      # Genera una migración Drizzle
npm run db:migrate       # Ejecuta migraciones
npm run db:studio        # Abre Drizzle Studio
```

## Integración con Expo

En la app `truco-app`, configura una URL accesible desde el dispositivo:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.10:3000/api/v1
```

Desde un simulador iOS, `http://localhost:3000/api/v1` normalmente funciona. Desde un dispositivo físico se debe usar la IP local de la computadora o un entorno remoto.

## Documentación

- [`docs/STACK.md`](docs/STACK.md): tecnologías, responsabilidades y arquitectura.
- [`docs/DEVELOPMENT_RULES.md`](docs/DEVELOPMENT_RULES.md): reglas para agregar endpoints, módulos y eventos en tiempo real.
- [`docs/GAME_API.md`](docs/GAME_API.md): endpoints de salas, reparto, cartas y cantos.
