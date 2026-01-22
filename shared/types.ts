export interface iPlayer {
    id: string
    firebaseId: string
    x: number
    y: number
    angle: number
    hp: number
    name: string
    kills: number
}

export interface PlayerInputs {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
  shoot: boolean
  angle: number
}

export interface iBullet {
    id: string
    playerId: string
    x: number
    y: number
    vx: number
    vy: number
    angle: number
}