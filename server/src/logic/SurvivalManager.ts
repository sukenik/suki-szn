import { Server } from 'socket.io'
import { GAME_EVENTS, GAME_SETTINGS } from '../../../shared/consts'
import { iBullet, iHealPack, iPlayer } from '../../../shared/types'
import { BULLET_DAMAGE } from '../consts'
import { iSurvivalRoom } from '../room'
import { Bot } from './Bot'
import { getIsCollidingBullet, getNewHealPacks, respawnPlayer, setBots, updateHeals } from './gameUtils'

const { TICK_RATE, PLAYER_RADIUS, WORLD_WIDTH, WORLD_HEIGHT } = GAME_SETTINGS

export class SurvivalManager {
	private bots: Bot[] = []
    private bullets: iBullet[] = []
    private healPacks: iHealPack[]
    private currentWave: number = 0
    private isActive: boolean = false

	constructor(
        private io: Server,
        private room: iSurvivalRoom,
    ) {
        this.healPacks = getNewHealPacks()
    }

	public getBots() { return this.bots }
    public getBullets() { return this.bullets }
    public getHealPacks() { return this.healPacks }
    public getCurrentWave() { return this.currentWave }
    public addBullet(bullet: iBullet) { this.bullets.push(bullet) }

    public start() {
        this.isActive = true
        this.nextWave()
    }

    public async nextWave() {
		if (!this.isActive) return

        this.currentWave++
        const botsToSpawn = this.currentWave + 1
        
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

	public update(roomPlayers: { [id: string]: iPlayer }) {
		if (!this.isActive) return

        this.bots.forEach(bot => bot.update(roomPlayers, this.healPacks))

        this.updateBullets(roomPlayers)

        updateHeals(this.healPacks, roomPlayers, this.bots)
	}

    public onBotKilled(botId: string) {
        this.bots = this.bots.filter(b => b.id !== botId)

        if (this.bots.length === 0 && this.isActive) {
            setTimeout(() => this.nextWave(), 3000)
        }
    }

	private updateBullets(roomPlayers: { [id: string]: iPlayer }) {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const bullet = this.bullets[i]

			console.log(roomPlayers)
			console.log(bullet.x)

			if (!bullet) continue

            bullet.x += bullet.vx / TICK_RATE
            bullet.y += bullet.vy / TICK_RATE

			if (getIsCollidingBullet(bullet.x, bullet.y)) {
				this.bullets.splice(i, 1)
				continue
			}

			let bulletDestroyed = false
	
			for (const id in this.room.players) {
				const player = roomPlayers[id]

				if (!player || bullet.playerId === id) continue

				const dist = Math.hypot(bullet.x - player.x, bullet.y - player.y)

				if (dist < PLAYER_RADIUS) {
					if ((player as Bot)?.isBot) {
						const bot = this.bots.find(b => b.id === id)
	
						if (bot) {
							bot.hp -= BULLET_DAMAGE
						}
					}

					this.handleHit(player, id, bullet.id, this.bots)
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
		player: iPlayer, id: string, bulletId: string, bots: Bot[]
	) {
        player.hp -= BULLET_DAMAGE

        if (player.hp <= 0) {
			// TODO:
            // לוגיקת מוות ב-Survival (אולי Respawn מוגבל?)
			respawnPlayer(player, id, bulletId, bots)
        }

        this.io.to(this.room.id).emit(GAME_EVENTS.PLAYER_HIT, { 
            playerId: player.id, hp: player.hp, bulletId 
        })
    }
}