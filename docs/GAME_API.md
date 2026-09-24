# API de juego

Todos los endpoints requieren `Authorization: Bearer <accessToken>`.

## Salas

`POST /api/v1/rooms`

El cuerpo es opcional. Los valores predeterminados son `targetScore: 30` y `withFlor: true`.

```json
{
  "maxPlayers": 2,
  "targetScore": 15,
  "withFlor": false
}
```

`POST /api/v1/rooms/join`

```json
{ "code": "ABC234" }
```

`GET /api/v1/rooms/:roomId` devuelve la configuración y los miembros.

`POST /api/v1/rooms/bot` crea e inicia inmediatamente una sala de dos jugadores contra el bot. Acepta `targetScore` y `withFlor` con los mismos valores predeterminados.

## Partida

`POST /api/v1/rooms/:roomId/game` inicia la partida cuando hay 2 o 4 jugadores y reparte tres cartas a cada uno.

`GET /api/v1/rooms/:roomId/game` devuelve el estado público. La mano completa solo se envía al jugador autenticado; las cartas rivales se mantienen ocultas hasta ser jugadas. Cuando un Envido aceptado queda resuelto y la mano termina, `revealedCards` contiene únicamente las cartas restantes del ganador de los tantos que el motor tira automáticamente antes del siguiente reparto.

`POST /api/v1/rooms/:roomId/game/actions` ejecuta una acción atómica y valida `expectedVersion` cuando se envía:

```json
{ "type": "play_card", "cardId": "7-espadas", "expectedVersion": 3 }
```

Acciones válidas: `play_card`, `new_hand`, `truco`, `retruco`, `vale_cuatro`, `envido`, `real_envido`, `falta_envido`, `flor`, `contra_flor`, `contra_flor_al_resto`, `quiero`, `no_quiero` y `fold`.

El estado público incluye `availableActions`, calculado para el jugador autenticado, y `lastAction` para mostrar el último canto, la ida al mazo o el resultado del Envido. La app debe renderizar `availableActions` y el backend vuelve a validarla al recibir cada acción.

El motor conserva las reglas de valores de cartas, ganador de cada ronda, ganador de la mano, Falta Envido, empates por mano y puntuación de Truco/Envido en backend. Cada acción incrementa `stateVersion` y se registra en `game_events`.
