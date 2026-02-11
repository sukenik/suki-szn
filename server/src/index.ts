import 'dotenv/config'
import express from 'express'
import * as admin from 'firebase-admin'
import { createServer } from 'http'
import { Server, Socket } from 'socket.io'
import { v4 as uuidv4 } from 'uuid'
import { GAME_ERRORS, GAME_EVENTS, GAME_MODE, GAME_SETTINGS } from '../../shared/consts'
import { iBullet, iCircleObstacle, iCompoundRectObstacle, iHealPack, iPlayer, iPlayerInputs, iRectObstacle, iServerUpdateData, ObstaclesType } from '../../shared/types'
import { recordMiss, saveBufferToFile } from './ai/recordData'
import { supabase } from './db'
import { AStarPathfinder } from './logic/AStarPathfinder'
import { Bot } from './logic/Bot'
import { broadcastLeaderboard, getNewHealPacks, setBots, updateBullets, updateHeals, updatePlayerPhysics } from './logic/gameUtils'
import { GridManager } from './logic/GridManager'
import { SurvivalManager } from './logic/SurvivalManager'
import { generateNewLocation, startCountdown, stopCountdown } from './logic/survivalUtils'
import { getPlayersInRoom, getRoomIds, iSurvivalRoom, survivalRooms } from './room'

const app = express()

app.get('/health', (_, res) => {
    res.status(200).send('OK')
})

const httpServer = createServer(app)
export const io = new Server(httpServer, {
    cors: {
        origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
        methods: ['GET', 'POST']
    }
})

const {
    WORLD_WIDTH, WORLD_HEIGHT, MAX_HEALTH, TICK_RATE, PLAYER_SPEED
} = GAME_SETTINGS

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT as string)
export const isTrainingMode = process.env.TRAINING_MODE === 'true'

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
const bots: Bot[] = []
const bullets: iBullet[] = []
let healPacks: iHealPack[] = getNewHealPacks()
let lastUpdate = Date.now()

export const gridManager = new GridManager(WORLD_WIDTH, WORLD_HEIGHT, 50)
export const pathfinder = new AStarPathfinder(gridManager)
export const survivalManagers = new Map<string, SurvivalManager>()

export const obstacles: ObstaclesType = [
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

if (isTrainingMode) {
    setInterval(saveBufferToFile, 60 * 1000)
    setInterval(recordMiss, 1000)

    try {
        setBots(bots, 10,
            (bulletData) => {
                bullets.push(bulletData)
                io.emit(GAME_EVENTS.NEW_BULLET, bulletData)
            }
        )
    } catch (error) {
        console.log(error)
    }
}

setInterval(async () => {
    const now = Date.now()
    const dt = (now - lastUpdate) / 1000
    lastUpdate = now

    updatePlayerPhysics(players, dt)

    const playersInSurvival = new Set<string>()
    const survivalRoomIds = getRoomIds()

    for (const roomId of survivalRoomIds) {
        const roomPlayers = getPlayersInRoom(roomId, players)
        Object.keys(roomPlayers).forEach(id => playersInSurvival.add(id))
    }

    const multiplayerPlayers: { [id: string]: iPlayer } = {}

    Object.keys(players).forEach(id => {
        const socket = io.sockets.sockets.get(id)
        const isMultiplayer = socket?.handshake.auth.mode === GAME_MODE.MULTIPLAYER

        if (!playersInSurvival.has(id) && isMultiplayer) {
            multiplayerPlayers[id] = players[id]
        }
    })

    bots.forEach(bot => {
        if (!bot.roomId) {
            // TODO: fix
            bot.update(multiplayerPlayers, healPacks, dt, true)
            players[bot.id] = { ...bot } as iPlayer
            multiplayerPlayers[bot.id] = players[bot.id]
        }
    })

    updateHeals(healPacks, multiplayerPlayers, bots)
    updateBullets(bullets, multiplayerPlayers, bots, dt)

    const finishedManagers: string[] = []

    survivalManagers.forEach((manager, roomId) => {
        if (manager.getIsGameOver()) {
            finishedManagers.push(roomId)
            return
        }
        const roomPlayers = getPlayersInRoom(roomId, players)

        manager.update(roomPlayers, dt)

        const roomBots = manager.getBots()

        const combinedPlayers = { ...roomPlayers }

        roomBots.forEach(bot => {
            combinedPlayers[bot.id] = bot as iPlayer
        })

        const updateData: iServerUpdateData = {
            obstacles,
            players: combinedPlayers,
            bullets: manager.getBullets(),
            heals: manager.getHealPacks(),
            wave: manager.getCurrentWave(),
        }

        io.to(roomId).emit(GAME_EVENTS.SERVER_UPDATE, updateData)
    })

    finishedManagers.forEach(roomId => {
        survivalManagers.delete(roomId)
    })

    const multiplayerUpdate: iServerUpdateData = {
        players: multiplayerPlayers,
        bullets,
        heals: healPacks,
        obstacles
    }
    io.sockets.sockets.forEach((socket) => {
        if (!playersInSurvival.has(socket.id)) {
            const otherPlayers = { ...multiplayerPlayers }
            delete otherPlayers[socket.id]

            socket.emit(GAME_EVENTS.SERVER_UPDATE, {
                ...multiplayerUpdate,
                players: otherPlayers
            })
        }
    })

}, 1000 / TICK_RATE)

io.on('connection', async (socket) => {
    setupGameEvents(socket)

    socket.on(GAME_EVENTS.REQUEST_INITIAL_STATE, async () => {
        console.log(`[Socket ${socket.id}] requested state. Sending ${Object.keys(players).length} players.`)

        socket.emit(GAME_EVENTS.CURRENT_PLAYERS, players)
        socket.emit(GAME_EVENTS.INITIAL_OBSTACLES, obstacles)

        if (socket.handshake.auth.mode === GAME_MODE.SURVIVAL) {
            const roomValues = socket.rooms.keys()
            roomValues.next().value
            const roomId = roomValues.next().value || ''
    
            const manager = survivalManagers.get(roomId)

            manager && manager.broadcastLeaderboard()
        }
        else {
            await broadcastLeaderboard()
        }
    })

    try {
        const token = socket.handshake.auth.token
        const decodedToken = await admin.auth().verifyIdToken(token)
        const userId = decodedToken.uid

        const existingPlayer = Object.values(players).find(p => p.firebaseId === userId)

        if (existingPlayer) {
            console.log(`Found existing player for UID ${decodedToken.uid}, reconnecting...`)
            const oldSocket = io.sockets.sockets.get(existingPlayer.id)

            if (oldSocket) {
                oldSocket.disconnect(true)
            }

            const oldId = existingPlayer.id
            const newId = socket.id

            if (existingPlayer.hp <= 0) {
                players[newId] = {
                    ...existingPlayer,
                    ...generateNewLocation(),
                    id: newId,
                    hp: MAX_HEALTH,
                    kills: 0,
                    vx: 0,
                    vy: 0,
                }
            }
            else {
                players[newId] = { ...existingPlayer, id: newId, vx: 0, vy: 0 }
            }

            delete players[oldId]

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

            io.emit(GAME_EVENTS.PLAYER_LEFT, oldId)
            socket.broadcast.emit(GAME_EVENTS.PLAYER_JOINED, players[newId])

            console.log(`User ${players[newId].name} reconnected successfully.`)
            return
        }

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

        // TODO: Remove any
        (socket as any).userData = user

        players[socket.id] = {
            id: socket.id,
            firebaseId: userId,
            ...generateNewLocation(),
            angle: 0,
            hp: MAX_HEALTH,
            name: user.username,
            kills: 0,
            vx: 0,
            vy: 0
        }

        if (socket.handshake.auth.mode === GAME_MODE.MULTIPLAYER) {
            socket.broadcast.emit(GAME_EVENTS.PLAYER_JOINED, players[socket.id])
        }
        console.log(`User ${user.username} authenticated and joined the game.`)
    } catch (error) {
        console.error('Authentication failed:', error)
        socket.disconnect()
    }
})

const setupGameEvents = async (socket: Socket) => {
    socket.on(GAME_EVENTS.CREATE_SURVIVAL, async () => {
        let attempts = 0

        while (!players[socket.id] && attempts < 20) {
            await new Promise(resolve => setTimeout(resolve, 100))
            attempts++
        }

        if (!players[socket.id]) {
            console.error('Auth timeout for socket:', socket.id)
            return
        }

        const roomId = uuidv4()
        const roomData: iSurvivalRoom = {
            id: roomId,
            hostId: socket.id,
            players: [socket.id],
            readyStatus: new Map([[socket.id, false]]),
            isStarted: false,
            currentWave: 0
        }

        survivalRooms.set(roomId, roomData)

        socket.join(roomId)

        socket.emit(GAME_EVENTS.ROOM_CREATED, { roomId })

        const playersInRoom = roomData.players.map(pid => ({
            id: pid,
            name: players[pid]?.name || 'Unknown',
            ready: roomData.readyStatus.get(pid) || false
        }))

        io.to(roomId).emit(GAME_EVENTS.ROOM_UPDATE, { players: playersInRoom })
    })

    socket.on(GAME_EVENTS.JOIN_SURVIVAL, async (roomId: string) => {
        console.log(`User ${socket.id} trying to join room: ${roomId}`)

        let attempts = 0

        while (!players[socket.id] && attempts < 20) {
            await new Promise(resolve => setTimeout(resolve, 100))
            attempts++
        }

        const room = survivalRooms.get(roomId)

        if (!room) {
            socket.emit('error', GAME_ERRORS.ROOM_NOT_FOUND)
            return
        }

        if (room.isStarted) {
            socket.emit('error', GAME_ERRORS.GAME_IN_PROGRESS)
            return
        }

        if (!room.players.some(pid => pid === socket.id)) {
            room.players.push(socket.id)
            room.readyStatus.set(socket.id, false)
        }

        socket.join(roomId)

        socket.emit(GAME_EVENTS.ROOM_JOINED, { roomId })

        const playersInRoom = room.players.map(pid => ({
            id: pid,
            name: players[pid]?.name || 'Unknown',
            ready: room.readyStatus.get(pid) || false
        }))

        io.to(roomId).emit(GAME_EVENTS.ROOM_UPDATE, { players: playersInRoom })
    })

    socket.emit(GAME_EVENTS.CURRENT_PLAYERS, players)
    socket.broadcast.emit(GAME_EVENTS.PLAYER_JOINED, players[socket.id])

    await broadcastLeaderboard()

    socket.on(GAME_EVENTS.INPUT_UPDATE, (inputData: iPlayerInputs) => {
        const player = players[socket.id]
        if (!player) return

        const { vx, vy, angle } = inputData

        player.vx = vx * PLAYER_SPEED
        player.vy = vy * PLAYER_SPEED
        player.angle = angle

        player.lastInput = inputData
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

        let inSurvival = false

        survivalManagers.forEach((manager, roomId) => {
            const playersInRoom = getPlayersInRoom(roomId, players)

            if (Object.keys(playersInRoom).some(id => id === socket.id)) {
                manager.addBullet(bulletData)
                io.to(roomId).emit(GAME_EVENTS.NEW_BULLET, bulletData)
                inSurvival = true
            }
        })

        if (!inSurvival) {
            bullets.push(bulletData)
            io.emit(GAME_EVENTS.NEW_BULLET, bulletData)
        }
    })

    socket.on(GAME_EVENTS.TOGGLE_READY, (roomId: string) => {
        const room = survivalRooms.get(roomId)
        if (!room) return

        const currentStatus = room.readyStatus.get(socket.id)
        room.readyStatus.set(socket.id, !currentStatus)

        const playersInRoom = room.players.map(pid => ({
            id: pid,
            name: players[pid]?.name || 'Unknown',
            ready: room.readyStatus.get(pid)
        }))

        io.to(roomId).emit(GAME_EVENTS.ROOM_UPDATE, { players: playersInRoom })

        const allReady = Array.from(room.readyStatus.values()).every(status => status)

        if (allReady && room.players.length > 0 && room.players.length <= 4) {
            room.isStarted = true
            startCountdown(roomId, io, playersInRoom)
        }
        else {
            stopCountdown(roomId, io)
        }
    })

    socket.on('disconnect', () => {
        console.log(`User disconnected ${socket.id}`)

        setTimeout(() => {
            if (players[socket.id]) {
                survivalRooms.forEach((room, roomId) => {
                    if (room.players.some(pid => pid == socket.id)) {
                        room.players = room.players.filter(pid => pid !== socket.id)
                        room.readyStatus.delete(socket.id)
        
                        if (room.players.length === 0) {
                            survivalRooms.delete(roomId)
                        }
                        else {
                            const updatedPlayers = room.players.map(pid => ({
                                id: pid,
                                name: players[pid]?.name || 'Unknown',
                                ready: room.readyStatus.get(pid)
                            }))
        
                            io.to(roomId).emit(GAME_EVENTS.ROOM_UPDATE, { players: updatedPlayers })
                        }
                    }
                })

                delete players[socket.id]
                io.emit(GAME_EVENTS.PLAYER_LEFT, socket.id)
            }
        }, 5000)
    })
}

const port = process.env.PORT || 3000

httpServer.listen(port, () => {
    console.log(`🚀 suki-szn server runs on http://localhost:${port}`)
})