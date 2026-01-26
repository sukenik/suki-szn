import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server, Socket } from 'socket.io'
import { iBullet, iCircleObstacle, iCompoundRectObstacle, iHealPack, iPlayer, iPlayerInputs, iRectObstacle, iServerUpdateData, ObstaclesType } from '../../shared/types'
import { GAME_SETTINGS, GAME_EVENTS } from '../../shared/consts'
import * as admin from 'firebase-admin'
import { supabase } from './db'
import { GridManager } from './logic/GridManager'

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
    cors: {
        origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
        methods: ['GET', 'POST']
    }
})

const BULLET_DAMAGE = 10
const {
    WORLD_WIDTH, WORLD_HEIGHT, MAX_HEALTH, PLAYER_RADIUS, TICK_RATE,
    PLAYER_SPEED
} = GAME_SETTINGS

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT as string)

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
})

io.use((socket, next) => {
    const ip = socket.handshake.address
    const count = connectionsByIP.get(ip) || 0
    const maxConnectionsAllowed = process.env.MAX_CONNECTIONS_PER_IP !== undefined
        ? Number(process.env.MAX_CONNECTIONS_PER_IP)
        : 5

    if (count > maxConnectionsAllowed) {
        return next(new Error('Too many connections from this IP'))
    }

    connectionsByIP.set(ip, count + 1)

    socket.on('disconnect', () => {
        const currentCount = connectionsByIP.get(ip) || 1
        connectionsByIP.set(ip, currentCount - 1)
    })

    next()
})

const connectionsByIP = new Map<string, number>()
const players: { [id: string]: iPlayer } = {}
const bullets: iBullet[] = []
const gridManager = new GridManager(WORLD_WIDTH, WORLD_HEIGHT, 50)
const obstacles: ObstaclesType = [
    { type: 'circle', worldX: 1000, worldY: 1000, radius: 150 },
    { type: 'circle', worldX: 400, worldY: 1500, radius: 100 },
    {
        type: 'compound_rect',
        worldX: 1500,
        worldY: 500,
        rects: [
            { x: 60, y: 0, w: 30, h: 335 },
            { x: 0, y: 25, w: 150, h: 150 }
        ]
    }
]
obstacles.forEach(obs => {
    if (obs.type === 'circle') {
        gridManager.addCircleObstacle(obs as iCircleObstacle)
    }
    else if (obs.type === 'rect') {
        gridManager.addRectObstacle(obs as iRectObstacle)
    }
    else if (obs.type === 'compound_rect') {
        gridManager.addCompoundRectObstacle(obs as iCompoundRectObstacle)
    }
})

const checkCollision = (nextX: number, nextY: number, safetyMargin?: number) => {
    const margin = safetyMargin ?? 0

    for (const obs of obstacles) {
        if (obs.type === 'circle') {
            const circle = obs as iCircleObstacle

            const dist = Math.hypot(nextX - circle.worldX, nextY - circle.worldY)

            if (dist < circle.radius + PLAYER_RADIUS + margin) {
                return true
            }
        }
        else if (obs.type === 'rect') {
            const { worldX, worldY, width, height } = obs as iRectObstacle

            if (
                nextX + PLAYER_RADIUS + margin > worldX
                && nextX - PLAYER_RADIUS - margin < worldX + width
                && nextY + PLAYER_RADIUS + margin > worldY
                && nextY - PLAYER_RADIUS - margin < worldY + height
            ) {
                return true
            }
        }
        else if (obs.type === 'compound_rect') {
            const { worldX, worldY, rects } = obs as iCompoundRectObstacle

            for (const subRect of rects) {
                const absX = worldX + subRect.x
                const absY = worldY + subRect.y

                if (
                    nextX + PLAYER_RADIUS + margin > absX
                    && nextX - PLAYER_RADIUS - margin < absX + subRect.w
                    && nextY + PLAYER_RADIUS + margin > absY
                    && nextY - PLAYER_RADIUS - margin < absY + subRect.h
                ) {
                    return true
                }
            }
        }
    }

    return false
}

const generateNewLocation = () => {
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

let healPacks: iHealPack[] = Array.from({ length: 3 }).map((_, i) => ({
    id: `h${i}`,
    ...generateNewLocation(),
    active: true
}))

const updateHeals = () => {
    healPacks.forEach(pack => {
        if (!pack.active) return

        Object.values(players).forEach(player => {
            const dist = Math.hypot(player.x - pack.x, player.y - pack.y)

            if (player.hp !== MAX_HEALTH && (dist < PLAYER_RADIUS + 15)) {
                pack.active = false
                player.hp = Math.min(MAX_HEALTH, player.hp + 20)

                setTimeout(() => {
                    const { x, y } = generateNewLocation()

                    pack.active = true
                    pack.x = x
                    pack.y = y
                }, 10000)
            }
        })
    })
}

const updatePlayerPhysics = () => {
    Object.values(players).forEach((player) => {
        const input = player.lastInput
        if (!input) return

        player.angle = input.angle

        const moveStep = PLAYER_SPEED / TICK_RATE

        let nextX = player.x
        let nextY = player.y

        if (input.up)    nextY -= moveStep
        if (input.down)  nextY += moveStep
        if (input.left)  nextX -= moveStep
        if (input.right) nextX += moveStep

        const isColliding = checkCollision(nextX, nextY)

        if (!isColliding) {
            player.x = nextX
            player.y = nextY
        }
    })
}

const broadcastLeaderboard = async (io: any) => {
    const { data, error } = await supabase
        .from('users')
        .select('username, high_score')
        .order('high_score', { ascending: false })
        .limit(10)

    if (!error) {
        io.emit(GAME_EVENTS.LEADERBOARD_UPDATE, data)
    }
}

const sendMemoryLeaderboard = (io: any) => {
    const memoryData = Object.values(players)
        .map(p => ({
            username: p.name,
            high_score: p.kills
        }))
        .sort((a, b) => b.high_score - a.high_score)
        .slice(0, 10)

    io.emit(GAME_EVENTS.LEADERBOARD_UPDATE, memoryData)
}

setInterval(async () => {
    updatePlayerPhysics()
    updateHeals()

    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i]

        if (!bullet) continue

        bullet.x += bullet.vx / TICK_RATE
        bullet.y += bullet.vy / TICK_RATE

        const gridPos = gridManager.worldToGrid(bullet.x, bullet.y)
        const node = gridManager.getNode(gridPos.x, gridPos.y)

        if (node && !node.isWalkable) {
            bullets.splice(i, 1)
            continue
        }

        let bulletDestroyed = false

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
                        const killer = players[killerId]

                        if (killer) {
                            killer.kills += 1
    
                            supabase
                                .from('users')
                                .select('high_score')
                                .eq('firebase_id', killer.firebaseId)
                                .single()
                                .then(({ data: dbUser }) => {
                                    if (dbUser && killer.kills > dbUser.high_score) {
                                        return supabase
                                            .from('users')
                                            .update({ high_score: killer.kills })
                                            .eq('firebase_id', killer.firebaseId)
                                    }
                                })
                                .then(() => {
                                    broadcastLeaderboard(io)
                                })
                        }
                    }

                    player.hp = MAX_HEALTH
                    const { x, y } = generateNewLocation()
                    player.x = x
                    player.y = y

                    io.emit(GAME_EVENTS.PLAYER_DIED, {
                        playerId: id,
                        newX: player.x,
                        newY: player.y,
                        bulletId: bulletIdToDelete
                    })

                    sendMemoryLeaderboard(io)
                } else {
                    io.emit(GAME_EVENTS.PLAYER_HIT, { 
                        playerId: id, 
                        hp: player.hp,
                        bulletId: bullet.id
                    })
                }

                bullets.splice(i, 1)
                break
            }
        }

        if (bulletDestroyed) continue

        if (bullet.x < 0 || bullet.x > WORLD_WIDTH || bullet.y < 0 || bullet.y > WORLD_HEIGHT) {
            bullets.splice(i, 1)
        }
    }

    const updateData: iServerUpdateData = {
        players,
        bullets,
        heals: healPacks,
        obstacles
    }
    io.emit(GAME_EVENTS.SERVER_UPDATE, updateData)

}, 1000 / TICK_RATE)

io.on('connection', async (socket) => {
    socket.on(GAME_EVENTS.REQUEST_INITIAL_STATE, async () => {
        console.log(`[Socket ${socket.id}] requested state. Sending ${Object.keys(players).length} players.`)

        socket.emit(GAME_EVENTS.CURRENT_PLAYERS, players)
        socket.emit(GAME_EVENTS.INITIAL_OBSTACLES, obstacles)
        await broadcastLeaderboard(io)
    })

    try {
        const token = socket.handshake.auth.token
        const decodedToken = await admin.auth().verifyIdToken(token)
        const userId = decodedToken.uid

        let { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('firebase_id', userId)
            .single()

        if (error && error.code !== 'PGRST116') {
            console.error('Supabase error:', error)
            throw error
        }

        if (!user) {
            const { data: newUser, error: createError } = await supabase
                .from('users')
                .insert([{
                    firebase_id: userId,
                    username: decodedToken.name || 'New Pilot'
                }])
                .select()
                .single()

            if (createError) {
                console.error('Supabase Insert Error:', createError.message)
                console.error('Error Details:', createError.details)
                console.error('Error Hint:', createError.hint)
                return
            }

            user = newUser

            console.log('New user created in DB:', user.username)
        }
        (socket as any).userData = user

        players[socket.id] = {
            id: socket.id,
            firebaseId: userId,
            ...generateNewLocation(),
            angle: 0,
            hp: MAX_HEALTH,
            name: user.username,
            kills: 0
        }

        console.log(`User ${user.username} authenticated and joined the game.`)

        await setupGameEvents(socket)
    } catch (error) {
        console.error('Authentication failed:', error)
        socket.disconnect()
    }
})

const setupGameEvents = async (socket: Socket) => {
    socket.emit(GAME_EVENTS.CURRENT_PLAYERS, players)
    socket.broadcast.emit(GAME_EVENTS.PLAYER_JOINED, players[socket.id])

    await broadcastLeaderboard(io)

    socket.on(GAME_EVENTS.INPUT_UPDATE, (inputData: iPlayerInputs) => {
        const player = players[socket.id]

        if (player) {
            player.lastInput = inputData
        }
    })

    socket.on(GAME_EVENTS.PLAYER_SHOOT, (data: { vx: number, vy: number, x: number, y: number }) => {
        const player = players[socket.id]
        if (!player) return

        const dist = Math.hypot(data.x - player.x, data.y - player.y)

        const bulletX = dist < 50 ? data.x : player.x
        const bulletY = dist < 50 ? data.y : player.y

        const bulletId = Math.random().toString(36).substring(2, 9)
        const angleInRadians = Math.atan2(data.vy, data.vx)
        const angleInDegrees = angleInRadians * (180 / Math.PI)

        const bulletData: iBullet = {
            id: bulletId,
            playerId: socket.id,
            x: bulletX,
            y: bulletY,
            vx: data.vx,
            vy: data.vy,
            angle: angleInDegrees
        }

        bullets.push(bulletData)
        io.emit(GAME_EVENTS.NEW_BULLET, bulletData)
    })

    socket.on('disconnect', () => {
        console.log(`User disconnected ${socket.id}`)

        delete players[socket.id]
        io.emit(GAME_EVENTS.PLAYER_LEFT, socket.id)
    })
}

const port = process.env.PORT || 3000

httpServer.listen(port, () => {
    console.log(`🚀 suki-szn server runs on http://localhost:${port}`)
})