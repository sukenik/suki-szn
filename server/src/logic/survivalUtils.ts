import { Server } from 'socket.io'
import { survivalManagers } from '..'
import { GAME_EVENTS, GAME_SETTINGS } from '../../../shared/consts'
import { survivalRooms } from '../room'
import { checkCollision } from './gameUtils'
import { SurvivalManager } from './SurvivalManager'

const { WORLD_WIDTH, WORLD_HEIGHT } = GAME_SETTINGS

let countdowns = new Map<string, NodeJS.Timeout>()

export const startCountdown = (
    roomId: string,
    io: Server,
    playersInRoom: {
        id: string
        name: string
        ready: boolean | undefined
    }[]
) => {
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

                const manager = new SurvivalManager(
                    io,
                    room,
                    playersInRoom.map(({ name }) => name)
                )

                survivalManagers.set(roomId, manager)
                manager.start()
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

export const generateNewLocation = () => {
    const padding = 100
    const safetyMargin = 20
    let x = padding, y = padding
    let isValid = false
    let attempts = 0

    while (!isValid && attempts < 100) {
        x = Math.floor(Math.random() * (WORLD_WIDTH - padding * 2)) + padding
        y = Math.floor(Math.random() * (WORLD_HEIGHT - padding * 2)) + padding

        isValid = true

        const isColliding = checkCollision(x, y, safetyMargin)

        if (isColliding) {
            isValid = false
        }

        attempts++
    }

    return { x, y }
}