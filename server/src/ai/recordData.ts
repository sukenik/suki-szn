
import fs from 'fs'
import { GAME_SETTINGS } from '../../../shared/consts'
import { iPlayer } from '../../../shared/types'
import { Bot } from '../logic/Bot'
import { DATA_FILE_NAME } from '../consts'

interface iTrainingData {
	input: [number, number, number, number]
	output: [number]
}

export const shotTracking = new Map<string, any>()
export let dataBuffer: iTrainingData[] = []

export const recordShotAttempt = (bot: Bot, target: iPlayer, bulletId: string) => {
	const distance = Math.hypot(target.x - bot.x, target.y - bot.y)

	const targetVx = target.vx
	const targetVy = target.vy

	const angleToTarget = Math.atan2(target.y - bot.y, target.x - bot.x)
	const botAngleRad = (bot.angle - GAME_SETTINGS.ANGLE_OFFSET) * (Math.PI / 180)

	let diff = Math.abs(botAngleRad - angleToTarget)
	if (diff > Math.PI) diff = Math.PI * 2 - diff

	shotTracking.set(bulletId, {
		input: [distance, targetVx, targetVy, diff],
		timestamp: Date.now()
	})
}

export const recordMiss = () => {
	const now = Date.now()

	for (const [bulletId, shotInfo] of shotTracking.entries()) {
		if (now - shotInfo.timestamp > 2000) {
			dataBuffer.push({
				input: shotInfo.input,
				output: [0]
			})

			shotTracking.delete(bulletId)
			console.log(`Miss recorded. Buffer: ${dataBuffer.length}`)
		}
	}
}

export const recordHit = (bulletId: string) => {
	const shotInfo = shotTracking.get(bulletId)

	if (shotInfo) {
		dataBuffer.push({
			input: shotInfo.input,
			output: [1]
		})

		shotTracking.delete(bulletId)
		console.log(`Data collected: ${dataBuffer.length}`)
	}
}

export const saveBufferToFile = () => {
	if (dataBuffer.length === 0) return

	fs.writeFileSync(DATA_FILE_NAME, JSON.stringify(dataBuffer, null, 2))
	console.log(`✅ Saved ${dataBuffer.length} samples to ${DATA_FILE_NAME}`)
}