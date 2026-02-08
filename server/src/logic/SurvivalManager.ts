import { Server } from 'socket.io'
import { GAME_EVENTS, GAME_SETTINGS } from '../../../shared/consts'
import { iBullet, iHealPack, iLeaderboardUpdate, iPlayer } from '../../../shared/types'
import { BULLET_DAMAGE } from '../consts'
import { supabase } from '../db'
import { iSurvivalRoom } from '../room'
import { Bot } from './Bot'
import { broadcastLeaderboard, getIsCollidingBullet, getNewHealPacks, setBots, updateHeals } from './gameUtils'
import { generateNewLocation } from './survivalUtils'

const { PLAYER_RADIUS, WORLD_WIDTH, WORLD_HEIGHT, MAX_HEALTH } = GAME_SETTINGS

export class SurvivalManager {
	private bots: Bot[] = []
    private bullets: iBullet[] = []
    private healPacks: iHealPack[]
    private currentWave: number = 0
    private isActive: boolean = false
	private roomPlayersSnapshot: { [id: string]: iPlayer } = {}
	private leaderboardDataSnapshot: iLeaderboardUpdate[] = []

	constructor(
        private io: Server,
        private room: iSurvivalRoom,
		playerNamesInRoom: string[]
    ) {
        this.healPacks = getNewHealPacks()
		this.leaderboardDataSnapshot = playerNamesInRoom.map(
			name => ({ username: name, high_score: 0 })
		)
    }

	public getBots() { return this.bots }
    public getBullets() { return this.bullets }
    public getHealPacks() { return this.healPacks }
    public getCurrentWave() { return this.currentWave }
    public getIsActive() { return this.isActive }
    public getLeaderboardData() { return this.leaderboardDataSnapshot }
    public addBullet(bullet: iBullet) { this.bullets.push(bullet) }

    public start() {
        this.isActive = true
        this.nextWave()

		broadcastLeaderboard({
			data: this.getLeaderboardData(),
			wave: this.getCurrentWave()
		})
    }

    public async nextWave() {
		if (!this.isActive) return

        this.currentWave++
        const botsToSpawn = this.currentWave

        console.log(`[Room ${this.room.id}] Starting Wave ${this.currentWave} with ${botsToSpawn} bots`)

        this.io.to(this.room.id).emit(GAME_EVENTS.WAVE_STARTED, {
            wave: this.currentWave,
            botCount: botsToSpawn
        })

		setBots(
			this.bots,
			botsToSpawn,
			(bulletData) => {
				this.addBullet(bulletData)
				this.io.to(this.room.id).emit(GAME_EVENTS.NEW_BULLET, bulletData)
			},
			this.room.id
		)
    }

	public update(roomPlayers: { [id: string]: iPlayer }, dt: number) {
		if (!this.isActive) return

		this.roomPlayersSnapshot = roomPlayers

		const allEntitiesInRoom: { [id: string]: iPlayer } = { ...roomPlayers }
		this.bots.forEach(bot => {
			allEntitiesInRoom[bot.id] = bot as iPlayer
		})

        this.bots.forEach(bot => bot.update(allEntitiesInRoom, this.healPacks, dt))

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
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const bullet = this.bullets[i]

			if (!bullet) continue

			bullet.x += bullet.vx * dt
        	bullet.y += bullet.vy * dt

			if (getIsCollidingBullet(bullet.x, bullet.y)) {
				this.bullets.splice(i, 1)
				continue
			}

			let bulletDestroyed = false
	
			for (const id in roomPlayers) {
				const player = roomPlayers[id]

				if (!player || player.hp <= 0 || bullet.playerId === id) continue

				const isShooterBot = this.bots.some(b => b.id === bullet.playerId)
				const isTargetBot = (player as Bot)?.isBot

				if (isShooterBot && isTargetBot) continue
				if (!isShooterBot && !isTargetBot) continue

				const dist = Math.hypot(bullet.x - player.x, bullet.y - player.y)

				if (dist < PLAYER_RADIUS) {
					this.handleHit(player, bullet.id, roomPlayers, bullet.playerId)
					this.bullets.splice(i, 1)
					break
				}
	
				if (bulletDestroyed) continue
		
				if (
					bullet.x < 0
					|| bullet.x > WORLD_WIDTH
					|| bullet.y < 0
					|| bullet.y > WORLD_HEIGHT
				) {
					this.bullets.splice(i, 1)
				}
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

			broadcastLeaderboard({
				data: this.getLeaderboardData(),
				wave: this.getCurrentWave()
			})

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
		this.isActive = false

		const { data, error } = await supabase
			.from('users')
			.select('username, survival_high_score')
			.order('survival_high_score', { ascending: false })
			.limit(5)

		if (!error) {
			this.io.to(this.room.id).emit(GAME_EVENTS.GAME_OVER, data)
		}

		this.bots = []
		this.bullets = []
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
}