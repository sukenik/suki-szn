import { v4 as uuidv4 } from 'uuid'
import { gridManager, io, isTrainingMode, obstacles, pathfinder } from '..'
import { GAME_EVENTS, GAME_SETTINGS } from '../../../shared/consts'
import { iBullet, iCircleObstacle, iCompoundRectObstacle, iHealPack, iPlayer, iRectObstacle, iSurvivalLeaderboardUpdate, iLeaderboardUpdate } from '../../../shared/types'
import { recordHit, recordShotAttempt } from '../ai/recordData'
import { BULLET_DAMAGE } from '../consts'
import { supabase } from '../db'
import { Bot, ShootCallback } from './Bot'
import { generateNewLocation } from './survivalUtils'

const {
	PLAYER_RADIUS, MAX_HEALTH, WORLD_WIDTH, WORLD_HEIGHT, PLAYER_SPEED
} = GAME_SETTINGS

export const getIsCollidingBullet = (x: number, y: number) => {
	const gridPos = gridManager.worldToGrid(x, y)
	const node = gridManager.getNode(gridPos.x, gridPos.y)

	return node && !node.isWalkable
}

export const updateBullets = (
	bullets: iBullet[],
	players: { [id: string]: iPlayer },
	bots: Bot[],
	dt: number
) => {
	for (let i = bullets.length - 1; i >= 0; i--) {
		const bullet = bullets[i]

		if (!bullet) continue

		bullet.x += bullet.vx * dt
        bullet.y += bullet.vy * dt

		if (getIsCollidingBullet(bullet.x, bullet.y)) {
			bullets.splice(i, 1)
			continue
		}

		let bulletDestroyed = false

		for (const id in players) {
			const player = players[id]
			
			if (bullet.playerId === id) continue

			const dist = Math.hypot(bullet.x - player.x, bullet.y - player.y)
			
			if (dist < PLAYER_RADIUS) {
				isTrainingMode && recordHit(bullet.id)

				if ((player as Bot)?.isBot) {
					const bot = bots.find(b => b.id === id)

					if (bot) {
						bot.hp -= BULLET_DAMAGE
					}
				}

				player.hp -= BULLET_DAMAGE

				if (player.hp <= 0) {
					const killerId = bullet.playerId
					const killer = players[killerId]

					const isKillerBot = (killer as Bot)?.isBot
					const isVictimBot = (player as Bot)?.isBot

					if (!isVictimBot && !isKillerBot) {
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
								broadcastLeaderboard()
							})
					}

					respawnPlayer(player, id, bullet.id, bots)
				}
				else {
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
}

export const respawnPlayer = (
	player: iPlayer,
	id: string,
	bulletIdToDelete: string,
	bots: Bot[]
) => {
	const { x, y } = generateNewLocation()
	player.x = x
	player.y = y
	player.hp = MAX_HEALTH

	if ((player as Bot)?.isBot) {
		const actualBot = bots.find(b => b.id === id)

		if (actualBot) {
			actualBot.x = x
			actualBot.y = y
			actualBot.hp = MAX_HEALTH
		}
	}

	io.emit(GAME_EVENTS.PLAYER_DIED, {
		playerId: id,
		newX: x,
		newY: y,
		bulletId: bulletIdToDelete
	})
}

export const broadcastLeaderboard = async () => {
	const { data, error } = await supabase
		.from('users')
		.select('username, high_score')
		.order('high_score', { ascending: false })
		.limit(5)

    if (!error) {
        io.emit(GAME_EVENTS.LEADERBOARD_UPDATE, data as iLeaderboardUpdate[])
    }
}

export const updateHeals = (
	healPacks: iHealPack[],
	players: { [id: string]: iPlayer },
	bots: Bot[]
) => {
	healPacks.forEach(pack => {
		if (!pack.active) return

		Object.values(players).forEach(entity => {
			const dist = Math.hypot(entity.x - pack.x, entity.y - pack.y)

			if (entity.hp < MAX_HEALTH && (dist < PLAYER_RADIUS + 15)) {
				pack.active = false
				entity.hp = Math.min(MAX_HEALTH, entity.hp + 20)

                const botRef = bots.find(b => b.id === entity.id)
                if (botRef) {
                    botRef.hp = entity.hp
                }

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

export const updatePlayerPhysics = (players: { [id: string]: iPlayer }, dt: number) => {
	Object.values(players).forEach((player) => {
		const input = player.lastInput
		if (!input || (player as Bot)?.isBot) return

		player.angle = input.angle

		const moveStepX = input.vx * PLAYER_SPEED * dt
        const moveStepY = input.vy * PLAYER_SPEED * dt

		const nextX = Math.max(PLAYER_RADIUS, Math.min(WORLD_WIDTH - PLAYER_RADIUS, player.x + moveStepX))
        const nextY = Math.max(PLAYER_RADIUS, Math.min(WORLD_HEIGHT - PLAYER_RADIUS, player.y + moveStepY))

		if (!checkCollision(nextX, nextY)) {
			player.x = nextX
			player.y = nextY
			player.vx = input.vx * PLAYER_SPEED
            player.vy = input.vy * PLAYER_SPEED
		}
		else {
			player.vx = 0
			player.vy = 0
		}
	})
}

export const checkCollision = (
    nextX: number,
    nextY: number,
    safetyMargin?: number
) => {
	if (!obstacles) return

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

export const setBots = async (
	bots: Bot[],
	count: number,
	onShoot: ShootCallback,
	roomId?: string
) => {
	for (let i = 0; i < count; i++) {
		const id = `Bot-${uuidv4()}`
		const name = `Bot-${i + 1}`
	
		let location = generateNewLocation()

		let attempts = 0
		while (bots.some(b => Math.hypot(b.x - location.x, b.y - location.y) < 100) && attempts < 10) {
			location = generateNewLocation()
			attempts++
		}
	
		const bot = new Bot(
			id, location.x, location.y, name, pathfinder, gridManager, onShoot,
            (bulletData, target) => {
                isTrainingMode && recordShotAttempt(bot, target, bulletData.id)
            }
		)
	
		await bot.loadBrain()
	
		roomId && bot.setRoomId(roomId)

		bots.push(bot)
	}
}

export const getNewHealPacks = () => {
	return Array.from({ length: 3 }).map((_, i) => ({
		id: `h${i}`,
		active: true,
		...generateNewLocation()
	}))
}