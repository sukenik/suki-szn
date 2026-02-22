import { Socket } from 'socket.io'
import { io, multiplayerIdMap, survivalManagers } from '.'
import { GAME_EVENTS, GAME_SETTINGS } from '../../shared/consts'
import { iPlayer } from '../../shared/types'
import { generateNewLocation } from './logic/survivalUtils'
import { survivalRooms } from './room'

export const handleReconnection = (
	socket: Socket,
	existingPlayer: iPlayer,
	players: { [id: string]: iPlayer }
) => {
    const oldId = existingPlayer.id
    const newId = socket.id

    console.log(`[Reconnection] Swapping ${oldId} with ${newId}`)

    players[newId] = {
		...existingPlayer,
		id: newId,
		vx: 0,
		vy: 0,
		isAuthenticating: false
	}
    delete players[oldId]

    const oldSocket = io.sockets.sockets.get(oldId)
    if (oldSocket) oldSocket.disconnect(true)

	if (existingPlayer.hp <= 0) {
		players[newId] = {
			...existingPlayer,
			...generateNewLocation(),
			id: newId,
			hp: GAME_SETTINGS.MAX_HEALTH,
			kills: 0,
			vx: 0,
			vy: 0
		}
	}
	else {
		players[newId] = { ...existingPlayer, id: newId, vx: 0, vy: 0 }
	}

	for (const [roomId, room] of survivalRooms) {
		if (room.players.includes(oldId)) {
			room.players = room.players.map(pid => pid === oldId ? newId : pid)

			const wasReady = room.readyStatus.get(oldId) || false
			room.readyStatus.delete(oldId)
			room.readyStatus.set(newId, wasReady)

			if (room.hostId === oldId) {
				room.hostId = newId
			}

			socket.join(roomId)
			
			const playersInRoom = room.players.map(pid => ({
				id: pid,
				name: players[pid]?.name || 'Unknown',
				ready: room.readyStatus.get(pid) || false
			}))
			io.to(roomId).emit(GAME_EVENTS.ROOM_UPDATE, { players: playersInRoom })
			break
		}
	}

	survivalManagers.forEach((manager, roomId) => {
		const roomPlayers = survivalRooms.get(roomId)?.players || []

		if (roomPlayers.includes(newId)) {
			manager.updatePlayerId(oldId, newId)
		}
	})

	if (multiplayerIdMap.has(oldId)) {
		const numId = multiplayerIdMap.get(oldId)!
		multiplayerIdMap.delete(oldId)
		multiplayerIdMap.set(newId, numId)

		io.emit(GAME_EVENTS.ID_MAPPING, { id: newId, numId })
	}

	io.emit(GAME_EVENTS.PLAYER_LEFT, oldId)
    socket.broadcast.emit(GAME_EVENTS.PLAYER_JOINED, players[newId])
	socket.emit(GAME_EVENTS.CURRENT_PLAYERS, players)

	console.log(`User ${players[newId].name} reconnected successfully.`)
}