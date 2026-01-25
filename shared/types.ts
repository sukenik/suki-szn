export interface iPlayerInputs {
    up: boolean
    down: boolean
    left: boolean
    right: boolean
    shoot: boolean
    angle: number
}

export interface iPlayer {
    id: string
    firebaseId: string
    x: number
    y: number
    angle: number
    hp: number
    name: string
    kills: number
    lastInput?: iPlayerInputs
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

export interface iHealPack {
    id: string
    x: number
    y: number
    active: boolean
}

export interface iServerUpdateData {
    players: { [id: string]: iPlayer }
    bullets: iBullet[]
    heals: iHealPack[]
}