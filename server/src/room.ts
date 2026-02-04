export interface iSurvivalRoom {
    id: string
    hostId: string
    players: string[]
    readyStatus: Map<string, boolean>
    isStarted: boolean
    currentWave: number
}

export const survivalRooms = new Map<string, iSurvivalRoom>()