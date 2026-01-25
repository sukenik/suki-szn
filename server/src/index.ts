import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server, Socket } from 'socket.io'
import { iBullet, iHealPack, iPlayer, iPlayerInputs, iServerUpdateData } from '../../shared/types'
import { GAME_SETTINGS, GAME_EVENTS } from '../../shared/consts'
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

const generateNewLocation = () => {
    const padding = 50
    const x = Math.floor(Math.random() * (WORLD_WIDTH - padding * 2)) + padding
    const y = Math.floor(Math.random() * (WORLD_HEIGHT - padding * 2)) + padding

    return { x, y }
}

const connectionsByIP = new Map<string, number>()
const players: { [id: string]: iPlayer } = {}
const bullets: iBullet[] = []
let healPacks: iHealPack[] = Array.from({ length: 3 }).map((_, i) => ({
    id: `h${i}`,
    ...generateNewLocation(),
    active: true
}))
const BULLET_DAMAGE = 10

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

        const moveStep = PLAYER_SPEED / TICK_RATE
        let vx = 0
        let vy = 0

        if (input.up)    vy -= moveStep
        if (input.down)  vy += moveStep
        if (input.left)  vx -= moveStep
        if (input.right) vx += moveStep

        player.x += vx
        player.y += vy

        if (vx !== 0 || vy !== 0) {
            const radians = Math.atan2(vy, vx)
            player.angle = radians * (180 / Math.PI)
        }

        player.x = Math.max(0, Math.min(player.x, WORLD_WIDTH))
        player.y = Math.max(0, Math.min(player.y, WORLD_HEIGHT))
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
        heals: healPacks
    }
    io.emit(GAME_EVENTS.SERVER_UPDATE, updateData)

}, 1000 / TICK_RATE)

io.on('connection', async (socket) => {
    socket.on(GAME_EVENTS.REQUEST_INITIAL_STATE, async () => {
        console.log(`[Socket ${socket.id}] requested state. Sending ${Object.keys(players).length} players.`)

        socket.emit(GAME_EVENTS.CURRENT_PLAYERS, players)
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