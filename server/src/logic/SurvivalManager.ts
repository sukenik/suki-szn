import { Server } from 'socket.io'
import { GAME_EVENTS, GAME_SETTINGS } from '../../../shared/consts'
import { iBullet, iHealPack, iLeaderboardUpdate, iSurvivalLeaderboardUpdate, iPlayer, SurvivalRoomUpdateType } from '../../../shared/types'
import { BULLET_DAMAGE } from '../consts'
import { supabase } from '../db'
import { iSurvivalRoom, survivalRooms } from '../room'
import { Bot } from './Bot'
import { getIsCollidingBullet, getNewHealPacks, setBots, updateHeals } from './gameUtils'
import { generateNewLocation } from './survivalUtils'

const { PLAYER_RADIUS, WORLD_WIDTH, WORLD_HEIGHT, MAX_HEALTH } = GAME_SETTINGS

export class SurvivalManager {
	private bots: Bot[] = []
    private bullets: iBullet[] = []
    private healPacks: iHealPack[]
    private currentWave: number = 0
    private isActive: boolean = false
	private isGameOver: boolean = false
	private roomPlayersSnapshot: { [id: string]: iPlayer } = {}
	private leaderboardDataSnapshot: iLeaderboardUpdate[] = []
	private updateCounter = 0
	private socketIdToNumericId = new Map<string, number>()
    private nextNumericId = 1

	constructor(
        private io: Server,
        private room: iSurvivalRoom,
		playerNamesInRoom: string[]
    ) {
        this.healPacks = getNewHealPacks()
		this.leaderboardDataSnapshot = playerNamesInRoom.map(
			name => ({ username: name, high_score: 0 })
		)
		this.room.players.forEach(playerId => {
			this.getNumericId(playerId)
		})
    }

	public getBots() { return this.bots }
    public getBullets() { return this.bullets }
    public getHealPacks() { return this.healPacks }
    public getCurrentWave() { return this.currentWave }
    public getIsActive() { return this.isActive }
    public getLeaderboardData() { return this.leaderboardDataSnapshot }
    public getIsGameOver() { return this.isGameOver }
    public addBullet(bullet: iBullet) { this.bullets.push(bullet) }

    public start() {
        this.isActive = true
        this.nextWave()
		this.broadcastLeaderboard()
    }

    public async nextWave() {
		if (!this.isActive) return

        this.currentWave++
        const botsToSpawn = this.currentWave

		setBots(
			this.bots,
			botsToSpawn,
			(bulletData) => {
				this.addBullet(bulletData)
			},
			this.room.id
		)

		this.bots.forEach(bot => {
			this.getNumericId(bot.id)
		})

        console.log(`[Room ${this.room.id}] Starting Wave ${this.currentWave} with ${botsToSpawn} bots`)

        this.io.to(this.room.id).emit(GAME_EVENTS.WAVE_STARTED, {
            wave: this.currentWave,
            botCount: botsToSpawn
        })
    }

	public update(roomPlayers: { [id: string]: iPlayer }, dt: number) {
		if (!this.isActive) return

		this.roomPlayersSnapshot = roomPlayers

		const allEntitiesInRoom: { [id: string]: iPlayer } = { ...roomPlayers }
		this.bots.forEach(bot => {
			allEntitiesInRoom[bot.id] = bot as iPlayer
		})

		this.updateCounter++

        this.bots.forEach((bot, index) => {
			const isMyTurn = (this.updateCounter % 10) === (index % 10)

			bot.update(allEntitiesInRoom, this.bots, this.healPacks, dt, isMyTurn)
		})

        this.updateBullets(allEntitiesInRoom, dt)
        updateHeals(this.healPacks, allEntitiesInRoom, this.bots)
	}

    public onBotKilled(botId: string) {
        this.bots = this.bots.filter(b => b.id !== botId)

        if (this.bots.length === 0 && this.isActive) {
            setTimeout(() => this.nextWave(), 3000)
        }
    }

	private updateBullets(roomPlayers: { [id: string]: iPlayer }, dt: number) {
		const botIds = new Set(this.bots.map(b => b.id))

        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const bullet = this.bullets[i]

			if (!bullet) continue

			bullet.x += bullet.vx * dt
        	bullet.y += bullet.vy * dt

			if (getIsCollidingBullet(bullet.x, bullet.y)) {
				this.bullets.splice(i, 1)
				continue
			}

			if (
				bullet.x < 0 || 
				bullet.x > WORLD_WIDTH || 
				bullet.y < 0 || 
				bullet.y > WORLD_HEIGHT
			) {
				this.bullets.splice(i, 1)
				continue
	        }

			let bulletDestroyed = false
			const isShooterBot = botIds.has(bullet.playerId)

			for (const id in roomPlayers) {
				const player = roomPlayers[id]

				if (!player || player.hp <= 0 || bullet.playerId === id) continue

				const isTargetBot = (player as Bot)?.isBot

				if (isShooterBot && isTargetBot) continue
				if (!isShooterBot && !isTargetBot) continue

				const dist = Math.hypot(bullet.x - player.x, bullet.y - player.y)

				if (dist < PLAYER_RADIUS) {
					this.handleHit(player, bullet.id, roomPlayers, bullet.playerId)
					bulletDestroyed = true
					break
				}
        	}

			if (bulletDestroyed) {
				this.bullets.splice(i, 1)
			}
    	}
	}

    private handleHit(
		player: iPlayer,
		bulletId: string,
		roomPlayers: { [id: string]: iPlayer },
		killerId: string
	) {
        player.hp -= BULLET_DAMAGE

        if (player.hp <= 0) {
			const killer = roomPlayers[killerId]
			killer.kills += 1

			this.setLeaderboardData(roomPlayers)

			supabase
				.from('users')
				.select('survival_high_score')
				.eq('firebase_id', killer.firebaseId)
				.single()
				.then(({ data: dbUser }) => {
					if (dbUser && killer.kills > dbUser.survival_high_score) {
						return supabase
							.from('users')
							.update({ survival_high_score: killer.kills })
							.eq('firebase_id', killer.firebaseId)
					}
				})

			this.broadcastLeaderboard()

			const killedBot = this.bots.find(b => b.id === player.id)

			if (killedBot) {
				this.onBotKilled(player.id)
				this.io.to(this.room.id).emit(GAME_EVENTS.PLAYER_LEFT, player.id)
			}
			else {
				this.handlePlayerDeath(player)
			}
        }
		else {
			this.io.to(this.room.id).emit(GAME_EVENTS.PLAYER_HIT, { 
				playerId: player.id, hp: player.hp, bulletId 
			})
		}

    }

	private handlePlayerDeath(player: iPlayer) {
		player.hp = 0

		const playersInRoom = Object.values(this.roomPlayersSnapshot)
		const alivePlayers = playersInRoom.filter(p => p.hp > 0 && !(p as Bot).isBot)

		if (alivePlayers.length === 0) {
			this.gameOver()
		}
		else {
			console.log(`Player ${player.name} died. Waiting 10s for respawn...`)

			this.io.to(this.room.id).emit(GAME_EVENTS.PLAYER_DIED, { 
				playerId: player.id, 
				respawnIn: 10000 
			})

			setTimeout(() => {
				if (this.isActive && player.hp <= 0) {
					this.respawnSurvivor(player)
				}
			}, 10000)
		}
	}

	private respawnSurvivor(player: iPlayer) {
		const loc = generateNewLocation()
		player.x = loc.x
		player.y = loc.y
		player.hp = MAX_HEALTH
		player.vx = 0
		player.vy = 0

		this.io.to(this.room.id).emit(GAME_EVENTS.PLAYER_RESPAWN, {
			playerId: player.id,
			x: player.x,
			y: player.y,
			hp: player.hp
		})
	}

	private async gameOver() {
		const { data, error } = await supabase
			.from('users')
			.select('username, survival_high_score')
			.order('survival_high_score', { ascending: false })
			.limit(5)

		if (!error) {
			this.io.to(this.room.id).emit(GAME_EVENTS.GAME_OVER, data)
		}

		this.destroy()
	}

	private setLeaderboardData(roomPlayers: { [id: string]: iPlayer }) {
		this.leaderboardDataSnapshot = []

		for (const id of Object.keys(roomPlayers)) {
			const player = roomPlayers[id]

			if (player.id.includes('Bot')) continue

			this.leaderboardDataSnapshot.push(
				{ username: player.name, high_score: player.kills }
			)
		}
	}

	public broadcastLeaderboard() {
		this.io.to(this.room.id).emit(GAME_EVENTS.SURVIVAL_LEADERBOARD_UPDATE, {
			data: this.getLeaderboardData(),
			wave: this.getCurrentWave()
		} as iSurvivalLeaderboardUpdate)
	}

    private destroy() {
		this.bots = []
		this.bullets = []

        survivalRooms.set(this.room.id, {
			...this.room,
			isStarted: false,
			readyStatus: new Map(this.room.players.map(id => [id, false]))
		})

		const lobbyPlayers = this.room.players.map(pid => ({
			id: pid,
			name: this.roomPlayersSnapshot[pid].name || 'Unknown',
			ready: false
		})) as SurvivalRoomUpdateType

		this.io.to(this.room.id).emit(GAME_EVENTS.ROOM_UPDATE, { players: lobbyPlayers })

        console.log(`[Room ${this.room.id}] Game over. Cleaned up room.`)

		this.isActive = false
		this.isGameOver = true

		const playersInRoom = Object.values(this.roomPlayersSnapshot)
		playersInRoom.forEach(player => player.hp = MAX_HEALTH)
    }

	public getNumericId(id: string): number {
        if (!this.socketIdToNumericId.has(id)) {
            const numId = this.nextNumericId++
            this.socketIdToNumericId.set(id, numId)

            this.io.to(this.room.id).emit(GAME_EVENTS.ID_MAPPING, { id, numId })
        }

        return this.socketIdToNumericId.get(id)!
    }

	public syncPlayerMapping(socketId: string) {
		this.socketIdToNumericId.forEach((numId, id) => {
			this.io.to(socketId).emit(GAME_EVENTS.ID_MAPPING, { id, numId })
		})
	}

	public updatePlayerId(oldId: string, newId: string) {
		if (this.socketIdToNumericId.has(oldId)) {
			const numId = this.socketIdToNumericId.get(oldId)!
			this.socketIdToNumericId.delete(oldId)
			this.socketIdToNumericId.set(newId, numId)

			this.io.to(this.room.id).emit(GAME_EVENTS.ID_MAPPING, { id: newId, numId })
		}
	}

	public removePlayer(id: string) {
		this.socketIdToNumericId.delete(id)
	}
}