import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { GameEvents, iBullet, iPlayer } from '../../shared/types'
import { CLIENT_URL, GAME_HEIGHT, GAME_WIDTH, PLAYER_HP, PLAYER_SIZE_IN_PX } from '../../shared/consts'

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
    cors: {
        origin: CLIENT_URL,
        methods: ['GET', 'POST']
    }
})

const players: { [id: string]: iPlayer } = {}
const bullets: iBullet[] = []
const BULLET_DAMAGE = 10
const PLAYER_RADIUS = PLAYER_SIZE_IN_PX / 2
const TICK_RATE = 60

const generateNewLocation = () => {
    const padding = 50
    const spawnX = Math.floor(Math.random() * (GAME_WIDTH - padding * 2)) + padding
    const spawnY = Math.floor(Math.random() * (GAME_HEIGHT - padding * 2)) + padding

    return { spawnX, spawnY }
}

setInterval(() => {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i]

        bullet.x += bullet.vx / TICK_RATE
        bullet.y += bullet.vy / TICK_RATE

        for (const id in players) {
            const player = players[id]
            
            if (bullet.playerId === id) continue

            const dist = Math.hypot(bullet.x - player.x, bullet.y - player.y)
            
            if (dist < PLAYER_RADIUS) {
                player.hp -= BULLET_DAMAGE
                const bulletIdToDelete = bullet.id

                if (player.hp <= 0) {
                    const killerId = bullet.playerId

                    if (players[killerId]) {
                        players[killerId].kills += 1
                    }

                    player.hp = PLAYER_HP

                    const { spawnX, spawnY } = generateNewLocation()

                    player.x = spawnX
                    player.y = spawnY

                    io.emit(GameEvents.PLAYER_DIED, {
                        playerId: id,
                        newX: player.x,
                        newY: player.y,
                        bulletId: bulletIdToDelete
                    })
                    const leaderboardData = Object.values(players).map(p => ({
                        id: p.id,
                        kills: p.kills
                    }))
                    io.emit(GameEvents.LEADERBOARD_UPDATE, leaderboardData)
                } else {
                    io.emit(GameEvents.PLAYER_HIT, { 
                        playerId: id, 
                        hp: player.hp,
                        bulletId: bullet.id
                    })
                }

                bullets.splice(i, 1)
                break
            }
        }

        if (bullet.x < 0 || bullet.x > GAME_WIDTH || bullet.y < 0 || bullet.y > GAME_HEIGHT) {
            bullets.splice(i, 1)
        }
    }
}, 1000 / TICK_RATE)

io.on('connection', (socket) => {
    console.log(`New player connected: ${socket.id}`)

    const { spawnX, spawnY } = generateNewLocation()

    players[socket.id] = {
        id: socket.id,
        x: spawnX,
        y: spawnY,
        angle: 0,
        hp: PLAYER_HP,
        name: `Player-${socket.id.substring(0, 4)}`,
        kills: 0
    }

    socket.emit(GameEvents.CURRENT_PLAYERS, players)

    const leaderboardData = Object.values(players).map(p => ({
        id: p.id,
        kills: p.kills
    }))
    io.emit(GameEvents.LEADERBOARD_UPDATE, leaderboardData)

    socket.broadcast.emit(GameEvents.PLAYER_JOINED, players[socket.id])

    socket.on(GameEvents.PLAYER_MOVEMENT, (movementData: { x: number, y: number, angle: number }) => {
        if (players[socket.id]) {
            const validatedX = Math.max(0, Math.min(GAME_WIDTH, movementData.x))
            const validatedY = Math.max(0, Math.min(GAME_HEIGHT, movementData.y))

            players[socket.id].x = validatedX
            players[socket.id].y = validatedY
            players[socket.id].angle = movementData.angle

            socket.broadcast.emit(GameEvents.PLAYER_MOVED, players[socket.id])
        }
    })
    
    socket.on(GameEvents.PLAYER_SHOOT, (data: { vx: number, vy: number }) => {
        const player = players[socket.id]
        if (!player) return

        const bulletId = Math.random().toString(36).substring(2, 9)
        const angleInRadians = Math.atan2(data.vy, data.vx)
        const angleInDegrees = angleInRadians * (180 / Math.PI)

        const bulletData: iBullet = {
            id: bulletId,
            playerId: socket.id,
            x: player.x,
            y: player.y,
            vx: data.vx,
            vy: data.vy,
            angle: angleInDegrees
        }

        bullets.push(bulletData)
        io.emit(GameEvents.NEW_BULLET, bulletData)
    })

    socket.on('disconnect', () => {
        console.log(`User disconnected ${socket.id}`)
        
        delete players[socket.id]
        io.emit(GameEvents.PLAYER_LEFT, socket.id)

        const leaderboardData = Object.values(players).map(p => ({
            id: p.id,
            kills: p.kills
        }))
        io.emit(GameEvents.LEADERBOARD_UPDATE, leaderboardData)
    })
})

const PORT = 3000

httpServer.listen(PORT, () => {
    console.log(`🚀 suki-szn server runs on http://localhost:${PORT}`)
})