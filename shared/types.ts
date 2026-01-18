export interface iPlayer {
    id: string
    x: number
    y: number
    angle: number
    hp: number
    name: string
    kills: number
}

export const GameEvents = {
    PLAYER_JOINED: 'playerJoined',
    PLAYER_LEFT: 'playerLeft',
    PLAYER_MOVED: 'playerMoved',
    CURRENT_PLAYERS: 'currentPlayers',
    PLAYER_MOVEMENT: 'playerMovement',
    NEW_BULLET: 'newBullet',
    PLAYER_SHOOT: 'playerShoot',
    PLAYER_HIT: 'playerHit',
    PLAYER_DIED: 'playerDied',
    LEADERBOARD_UPDATE: 'leaderboardUpdate'
} as const

export type GameEventType = typeof GameEvents[keyof typeof GameEvents]

export interface iBullet {
    id: string
    playerId: string
    x: number
    y: number
    vx: number
    vy: number
    angle: number
}