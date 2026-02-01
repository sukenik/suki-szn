export const GAME_SETTINGS = {
  TICK_RATE: 60,
  WORLD_WIDTH: 2000,
  WORLD_HEIGHT: 2000,
  PLAYER_SPEED: 300,
  PLAYER_SIZE: 40,
  PLAYER_RADIUS: 25,
  MAX_HEALTH: 100,
  HEAL_AMOUNT: 20,
  HEAL_RESPAWN_TIME: 10000,
  GRID_SIZE: 50,
  BULLET_SPEED: 600,
  ANGLE_OFFSET: 90
} as const

export const GAME_EVENTS = {
  PLAYER_JOINED: 'playerJoined',
  PLAYER_LEFT: 'playerLeft',
  INPUT_UPDATE: 'inputUpdate',
  SERVER_UPDATE: 'serverUpdate',
  CURRENT_PLAYERS: 'currentPlayers',
  NEW_BULLET: 'newBullet',
  PLAYER_SHOOT: 'playerShoot',
  PLAYER_HIT: 'playerHit',
  PLAYER_DIED: 'playerDied',
  LEADERBOARD_UPDATE: 'leaderboardUpdate',
  REQUEST_INITIAL_STATE: 'requestInitialState',
  INITIAL_OBSTACLES: 'initialObstacles',
  ADMIN_ADD_BOT: 'adminAddBot',
  ADMIN_REMOVE_BOT: 'adminRemoveBot',
  REQUEST_IS_ADMIN: 'requestIsAdmin',
  IS_ADMIN: 'isAdmin',
} as const

export type GameEventType = typeof GAME_EVENTS[keyof typeof GAME_EVENTS]
