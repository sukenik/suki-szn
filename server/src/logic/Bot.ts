import * as tf from '@tensorflow/tfjs'
import fs from 'fs'
import path from 'path'
import { GAME_SETTINGS } from '../../../shared/consts'
import { iBullet, iHealPack, iPlayer } from '../../../shared/types'
import { MODEL_FILE_NAME } from '../consts'
import { AStarPathfinder } from './AStarPathfinder'
import { GridManager, iGridNode } from './GridManager'

enum BotState {
    CHASE,
    ATTACK,
    EVADE
}

type ShootCallback = (bulletData: iBullet) => void
type RecordCallback = (bulletData: iBullet, target: iPlayer) => void

const { PLAYER_SPEED, TICK_RATE, MAX_HEALTH, BULLET_SPEED, ANGLE_OFFSET } = GAME_SETTINGS

export class Bot implements iPlayer {
    public id: string
    public x: number
    public y: number
    public angle: number = 0
    public vx: number = 0
    public vy: number = 0
    public hp: number = MAX_HEALTH
    public name: string
    public kills: number = 0
    public firebaseId: string = 'bot-system'
    
    public isBot: boolean = true
    private lastPathCalc: number = 0
    private currentPath: iGridNode[] = []
    private pathfinder: AStarPathfinder
    private gridManager: GridManager
    private state: BotState = BotState.CHASE
    private onShoot: ShootCallback
    private onRecordShot?: RecordCallback
    private lastShotTime: number = 0
    private readonly SHOOT_COOLDOWN = 200
    private model?: tf.LayersModel

    constructor(
        id: string, x: number, y: number, name: string, pathfinder: AStarPathfinder,
        gridManager: GridManager, onShoot: ShootCallback, onRecordShot?: RecordCallback
    ) {
        this.id = id
        this.x = x
        this.y = y
        this.name = name
        this.pathfinder = pathfinder
        this.gridManager = gridManager
        this.onShoot = onShoot
        this.onRecordShot = onRecordShot
    }

    public update(allPlayers: { [id: string]: iPlayer }, healPacks: iHealPack[]) {
        const target = this.findClosestTarget(allPlayers)
        const allBots = Object.values(allPlayers).filter(
            player => (player as Bot)?.isBot
        ) as Bot[]

        this.evaluateState(target)

        switch (this.state) {
            case BotState.CHASE:
                if (target) {
                    this.handleNavigation(target)
                    this.move(target.x, target.y, allBots)
                }
                break
            case BotState.ATTACK:
                if (target) {
                    const sep = this.applySeparation(allBots, 0, 0)
                    this.x += sep.x
                    this.y += sep.y

                    const dist = Math.hypot(this.x - target.x, this.y - target.y)

                    if (dist > 150) {
                        this.move(target.x, target.y, allBots)
                    }
                    else {
                        this.vx = 0
                        this.vy = 0
                    }

                    this.lookAt(target.x, target.y)

                    const currentAngleRad = (this.angle - ANGLE_OFFSET) * (Math.PI / 180)
                    const angleToTarget = Math.atan2(target.y - this.y, target.x - this.x)

                    let diff = Math.abs(currentAngleRad - angleToTarget)
                    if (diff > Math.PI) diff = Math.PI * 2 - diff

                    if (this.shouldIShoot(dist, target, diff)) {
                        this.shoot(target)
                    }
                }
                break
            case BotState.EVADE:
                this.doEvade(healPacks, allBots, target)
                break
        }
    }

    private findClosestTarget(players: { [id: string]: iPlayer }): iPlayer | null {
        let closest: iPlayer | null = null
        let minDist = Infinity

        for (const id in players) {
            const p = players[id]

            if (p.id === this.id) continue

            const dist = Math.hypot(this.x - p.x, this.y - p.y)

            if (dist < minDist) {
                minDist = dist
                closest = p
            }
        }
        return closest
    }

    private handleNavigation(target: iPlayer) {
        const now = Date.now()

        if (now - this.lastPathCalc > 500 || this.isTargetFarFromPath(target)) {
            this.currentPath = this.pathfinder.findPath(this.x, this.y, target.x, target.y)
            this.lastPathCalc = now
        }
    }

    private isTargetFarFromPath(target: iPlayer): boolean {
        if (this.currentPath.length === 0) return true

        const lastNode = this.currentPath[this.currentPath.length - 1]
        const dist = Math.hypot(lastNode.worldX - target.x, lastNode.worldY - target.y)
        return dist > 100
    }

    private move(targetX: number, targetY: number, allBots: Bot[]) {
        const hasLOS = this.gridManager.hasLineOfSight(this.x, this.y, targetX, targetY)

        if (hasLOS) {
            this.currentPath = []
        }
        else {
            if (this.currentPath.length < 2) {
                this.vx = 0
                this.vy = 0
                return
            }

            const nextNode = this.currentPath[1]
            targetX = nextNode.worldX
            targetY = nextNode.worldY

            if (Math.hypot(targetX - this.x, targetY - this.y) < 10) {
                this.currentPath.shift()
                this.vx = 0
                this.vy = 0
                return
            }
        }

        const dx = targetX - this.x
        const dy = targetY - this.y
        const angleRad = Math.atan2(dy, dx)
        const moveStep = PLAYER_SPEED / TICK_RATE

        let vx = Math.cos(angleRad) * moveStep
        let vy = Math.sin(angleRad) * moveStep

        const separatedVelocity = this.applySeparation(allBots, vx, vy)

        const finalAngleRad = Math.atan2(separatedVelocity.y, separatedVelocity.x)

        this.angle = (finalAngleRad * (180 / Math.PI)) + ANGLE_OFFSET

        this.x += separatedVelocity.x
        this.y += separatedVelocity.y
        this.vx = separatedVelocity.x
        this.vy = separatedVelocity.y
    }

    private lookAt(targetX: number, targetY: number) {
        const dx = targetX - this.x
        const dy = targetY - this.y
        
        const angleRad = Math.atan2(dy, dx)
        this.angle = (angleRad * (180 / Math.PI)) + ANGLE_OFFSET
    }

    private evaluateState(target: iPlayer | null) {
        if (this.hp < GAME_SETTINGS.MAX_HEALTH * 0.3) {
            this.state = BotState.EVADE
            return
        }

        if (!target) {
            this.state = BotState.CHASE
            return
        }

        const dist = Math.hypot(this.x - target.x, this.y - target.y)
        const canSee = this.gridManager.hasLineOfSight(this.x, this.y, target.x, target.y)

        if (dist < 400 && canSee) {
            this.state = BotState.ATTACK
        }
        else {
            this.state = BotState.CHASE
        }
    }

    private shoot(target: iPlayer) {
        const now = Date.now()
        if (now - this.lastShotTime < this.SHOOT_COOLDOWN) return

        const dist = Math.hypot(target.x - this.x, target.y - this.y)
        const timeToHit = dist / BULLET_SPEED

        const predictedX = target.x + target.vx * timeToHit
        const predictedY = target.y + target.vy * timeToHit

        const dx = predictedX - this.x
        const dy = predictedY - this.y
        const predictedAngleRad = Math.atan2(dy, dx)

        const bulletData: iBullet = {
            id: `bullet-bot-${Math.random().toString(36).substr(2, 5)}`,
            playerId: this.id,
            x: this.x,
            y: this.y,
            vx: Math.cos(predictedAngleRad) * BULLET_SPEED,
            vy: Math.sin(predictedAngleRad) * BULLET_SPEED,
            angle: this.angle - ANGLE_OFFSET
        }

        this.onShoot(bulletData)

        if (this.onRecordShot) {
            this.onRecordShot(bulletData, target)
        }

        this.lastShotTime = now
    }

    private applySeparation(allBots: Bot[], vx: number, vy: number) {
        const SEPARATION_DISTANCE = 100
        let pushX = 0
        let pushY = 0

        allBots.forEach(other => {
            if (other.id === this.id) return

            const dist = Math.hypot(this.x - other.x, this.y - other.y)

            if (dist < SEPARATION_DISTANCE && dist > 0) {
                const force = (SEPARATION_DISTANCE - dist) / SEPARATION_DISTANCE

                pushX += (this.x - other.x) / dist * force * 2
                pushY += (this.y - other.y) / dist * force * 2
            }
        })

        return {
            x: vx + pushX,
            y: vy + pushY
        }
    }

    private doEvade(healPacks: iHealPack[], allBots: Bot[], target: iPlayer | null) {
        const activeHeals = healPacks.filter(h => h.active)

        if (activeHeals.length === 0) {
            if (target) {
                const dx = this.x - target.x
                const dy = this.y - target.y
                const angleToRun = Math.atan2(dy, dx)

                const x = Math.max(0, Math.min(GAME_SETTINGS.WORLD_WIDTH, this.x + Math.cos(angleToRun) * 500))
                const y = Math.max(0, Math.min(GAME_SETTINGS.WORLD_HEIGHT, this.y + Math.sin(angleToRun) * 500))

                this.move(x, y, allBots)
            }

            return
        }

        const closestHeal = activeHeals.reduce((prev, curr) => {
            const distPrev = Math.hypot(this.x - prev.x, this.y - prev.y)
            const distCurr = Math.hypot(this.x - curr.x, this.y - curr.y)
            return distCurr < distPrev ? curr : prev
        })

        const now = Date.now()

        if (now - this.lastPathCalc > 500) {
            this.currentPath = this.pathfinder.findPath(this.x, this.y, closestHeal.x, closestHeal.y)
            this.lastPathCalc = now
        }

        this.move(closestHeal.x, closestHeal.y, allBots)
    }

    async loadBrain() {
        try {
            const modelPath = path.join(__dirname, '..', 'ai', MODEL_FILE_NAME)

            const rawData = fs.readFileSync(modelPath, 'utf8')
            const manifest = JSON.parse(rawData)

            const buffer = Buffer.from(manifest.weightData, 'base64')
            const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

            this.model = await tf.loadLayersModel(tf.io.fromMemory({
                modelTopology: manifest.modelTopology,
                weightSpecs: manifest.weightSpecs,
                weightData: arrayBuffer as ArrayBuffer
            }))
        } catch (e: any) {
            console.log('❌ Failed to load brain:', e.message)
        }
    }

    shouldIShoot(distance: number, target: iPlayer, relativeAngle: number): boolean {
        if (!this.model) return true

        const targetVx = target.vx
        const targetVy = target.vy

        const input = tf.tensor2d([[
            distance / 1000,
            targetVx / 5,
            targetVy / 5,
            relativeAngle / Math.PI
        ]])

        const prediction = this.model.predict(input) as tf.Tensor
        const score = prediction.dataSync()[0]

        input.dispose()
        prediction.dispose()

        if (distance < 150) return score > 0.5

        return score > 0.75
    }
}