export interface iPlayerInputs {
    up: boolean
    down: boolean
    left: boolean
    right: boolean
    shoot: boolean
    angle: number
    vx: number
    vy: number
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
    vx: number
    vy: number
    lastInput?: iPlayerInputs
    isAuthenticating?: boolean
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

interface iBaseObstacle {
    type: 'circle' | 'rect' | 'compound_rect'
    worldX: number
    worldY: number
}

export interface iRectObstacle extends iBaseObstacle {
    width: number
    height: number
}

export interface iCircleObstacle extends iBaseObstacle {
    radius: number
}

export interface iCompoundRectObstacle extends iBaseObstacle {
    rects: {
        x: number
        y: number
        w: number
        h: number
    }[]
}

export type ObstaclesType = Array<iCircleObstacle | iRectObstacle | iCompoundRectObstacle>

export interface iLeaderboardUpdate {
    username: string
    high_score: number
}

export interface iSurvivalLeaderboardUpdate {
    data: iLeaderboardUpdate[]
    wave: number
}