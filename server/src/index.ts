import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server, Socket } from 'socket.io'
import { GameEvents, iBullet, iPlayer } from '../../shared/types'
import { GAME_HEIGHT, GAME_WIDTH, PLAYER_HP, PLAYER_SIZE_IN_PX } from '../../shared/consts'
import * as admin from 'firebase-admin'
import { supabase } from './db'

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
    cors: {
        origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
        methods: ['GET', 'POST']
    }
})

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
const BULLET_DAMAGE = 10
const PLAYER_RADIUS = PLAYER_SIZE_IN_PX / 2
const TICK_RATE = 60

const generateNewLocation = () => {
    const padding = 50
    const spawnX = Math.floor(Math.random() * (GAME_WIDTH - padding * 2)) + padding
    const spawnY = Math.floor(Math.random() * (GAME_HEIGHT - padding * 2)) + padding

    return { spawnX, spawnY }
}

const broadcastLeaderboard = async (io: any) => {
    const { data, error } = await supabase
        .from('users')
        .select('username, high_score')
        .order('high_score', { ascending: false })
        .limit(10)

    if (!error) {
        io.emit(GameEvents.LEADERBOARD_UPDATE, data)
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

    io.emit(GameEvents.LEADERBOARD_UPDATE, memoryData)
}

setInterval(async () => {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i]

        if (!bullet) continue

        bullet.x += bullet.vx / TICK_RATE
        bullet.y += bullet.vy / TICK_RATE

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

                    sendMemoryLeaderboard(io)
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

        if (bulletDestroyed) continue

        if (bullet.x < 0 || bullet.x > GAME_WIDTH || bullet.y < 0 || bullet.y > GAME_HEIGHT) {
            bullets.splice(i, 1)
        }
    }
}, 1000 / TICK_RATE)

io.on('connection', async (socket) => {
    socket.on(GameEvents.REQUEST_INITIAL_STATE, async () => {
        console.log(`[Socket ${socket.id}] requested state. Sending ${Object.keys(players).length} players.`)

        socket.emit(GameEvents.CURRENT_PLAYERS, players)
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

        const { spawnX, spawnY } = generateNewLocation()

        players[socket.id] = {
            id: socket.id,
            firebaseId: userId,
            x: spawnX,
            y: spawnY,
            angle: 0,
            hp: PLAYER_HP,
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
    socket.emit(GameEvents.CURRENT_PLAYERS, players)
    socket.broadcast.emit(GameEvents.PLAYER_JOINED, players[socket.id])

    await broadcastLeaderboard(io)

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
    
    socket.on(GameEvents.PLAYER_SHOOT, (data: { vx: number, vy: number, x: number, y: number }) => {
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
        io.emit(GameEvents.NEW_BULLET, bulletData)
    })

    socket.on('disconnect', () => {
        console.log(`User disconnected ${socket.id}`)

        delete players[socket.id]
        io.emit(GameEvents.PLAYER_LEFT, socket.id)
    })
}

const port = process.env.PORT || 3000

httpServer.listen(port, () => {
    console.log(`🚀 suki-szn server runs on http://localhost:${port}`)
})