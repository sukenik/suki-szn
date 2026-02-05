import { iPlayer } from '../../shared/types'

export interface iSurvivalRoom {
    id: string
    hostId: string
    players: string[]
    readyStatus: Map<string, boolean>
    isStarted: boolean
    currentWave: number
}

export const survivalRooms = new Map<string, iSurvivalRoom>()

export const getPlayersInRoom = (
    roomId: string, allPlayers: { [id: string]: iPlayer }
) => {
    const room = survivalRooms.get(roomId)
    const roomPlayersMap: { [id: string]: iPlayer } = {}

    if (room) {
        room.players.forEach(playerId => {
            if (allPlayers[playerId]) {
                roomPlayersMap[playerId] = allPlayers[playerId]
            }
        })
    }

    return roomPlayersMap
}