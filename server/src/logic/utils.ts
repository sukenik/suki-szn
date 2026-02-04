import { Server } from 'socket.io'
import { GAME_EVENTS } from '../../../shared/consts'
import { survivalRooms } from '../room'

let countdowns = new Map<string, NodeJS.Timeout>()

export const startCountdown = (roomId: string, io: Server) => {
	if (countdowns.has(roomId)) return

    let timeLeft = 10
    io.to(roomId).emit(GAME_EVENTS.STARTING_COUNTDOWN, timeLeft)

    const interval = setInterval(() => {
        timeLeft--

        io.to(roomId).emit(GAME_EVENTS.STARTING_COUNTDOWN, timeLeft)

        if (timeLeft <= 0) {
            clearInterval(interval)
			countdowns.delete(roomId)

            const room = survivalRooms.get(roomId)

            if (room) {
                room.isStarted = true
                io.to(roomId).emit(GAME_EVENTS.GAME_START)
            }
        }
    }, 1000)

    countdowns.set(roomId, interval)
}

export const stopCountdown = (roomId: string, io: Server) => {
    if (countdowns.has(roomId)) {
        clearInterval(countdowns.get(roomId)!)

		const room = survivalRooms.get(roomId)!
        survivalRooms.set(roomId, { ...room, isStarted: false })

        countdowns.delete(roomId)
        io.to(roomId).emit(GAME_EVENTS.STOP_COUNTDOWN)
    }
}