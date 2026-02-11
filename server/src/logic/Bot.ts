import * as tf from '@tensorflow/tfjs'
import fs from 'fs'
import path from 'path'
import { GAME_SETTINGS } from '../../../shared/consts'
import { iBullet, iHealPack, iPlayer } from '../../../shared/types'
import { MODEL_FILE_NAME } from '../consts'
import { AStarPathfinder } from './AStarPathfinder'
import { GridManager, iGridNode } from './GridManager'
import { survivalRooms } from '../room'

enum BotState {
    CHASE,
    ATTACK,
    EVADE
}

export type ShootCallback = (bulletData: iBullet) => void
export type RecordCallback = (bulletData: iBullet, target: iPlayer) => void

const {
    PLAYER_SPEED, MAX_HEALTH, BULLET_SPEED, ANGLE_OFFSET, PLAYER_RADIUS,
    WORLD_WIDTH, WORLD_HEIGHT
} = GAME_SETTINGS

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
    public roomId: string | null = null

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

    public update(
        allPlayers: { [id: string]: iPlayer },
        healPacks: iHealPack[],
        dt: number,
        runAI: boolean
    ) {
        const target = this.findClosestTarget(allPlayers)
        const allBots = Object.values(allPlayers).filter(
            player => (player as Bot)?.isBot
        ) as Bot[]

        if (runAI) {
            this.evaluateState(target)
        }

        switch (this.state) {
            case BotState.CHASE:
                if (target) {
                    if (runAI) this.handleNavigation(target)
                    this.move(target.x, target.y, allBots, dt)
                }
                break
            case BotState.ATTACK:
                if (target) {
                    const sep = this.applySeparation(allBots, 0, 0, dt)
                    this.x += sep.x
                    this.y += sep.y

                    const dist = Math.hypot(this.x - target.x, this.y - target.y)

                    if (dist > 150) {
                        this.move(target.x, target.y, allBots, dt)
                    }
                    else {
                        this.vx = sep.x / dt
                        this.vy = sep.y / dt
                    }

                    this.lookAt(target.x, target.y)

                    const currentAngleRad = (this.angle - ANGLE_OFFSET) * (Math.PI / 180)
                    const angleToTarget = Math.atan2(target.y - this.y, target.x - this.x)

                    let diff = Math.abs(currentAngleRad - angleToTarget)
                    if (diff > Math.PI) diff = Math.PI * 2 - diff

                    if (runAI && this.shouldIShoot(dist, target, diff)) {
                        this.shoot(target)
                    }
                }
                break
            case BotState.EVADE:
                this.doEvade(healPacks, allBots, target, dt)
                break
        }
    }

    public setRoomId(roomId: string) {
        this.roomId = roomId
    }

    private findClosestTarget(players: { [id: string]: iPlayer }): iPlayer | null {
        let closest: iPlayer | null = null
        let minDist = Infinity

        const allPlayersArray = Object.values(players)

        const validTargets = allPlayersArray.filter(p => {
            if (p.id === this.id) return false
            if ((p as Bot)?.isBot) return false
            if (p.hp <= 0) return false

            if (this.roomId) {
                const room = survivalRooms.get(this.roomId)
                return room?.players.includes(p.id)
            }

            return true
        })

        for (const p of validTargets) {
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

    private move(
        targetX: number,
        targetY: number,
        allBots: Bot[],
        dt: number,
        isHeal: boolean = false
    ) {
        const hasLOSDirect = this.gridManager.hasLineOfSight(this.x, this.y, targetX, targetY)

        let finalTargetX = targetX
        let finalTargetY = targetY

        const distToPlayer = Math.hypot(targetX - this.x, targetY - this.y)
        const attackRadius = 250 

        if (!isHeal && hasLOSDirect && distToPlayer < attackRadius) {
            const angleFromPlayer = Math.atan2(this.y - targetY, this.x - targetX)
            finalTargetX = targetX + Math.cos(angleFromPlayer) * attackRadius
            finalTargetY = targetY + Math.sin(angleFromPlayer) * attackRadius
        }

        if (!hasLOSDirect) {
            if (this.currentPath.length < 2) {
                this.currentPath = this.pathfinder.findPath(this.x, this.y, finalTargetX, finalTargetY)
            }
            
            if (this.currentPath.length >= 2) {
                const nextNode = this.currentPath[1]
                finalTargetX = nextNode.worldX
                finalTargetY = nextNode.worldY
                
                if (Math.hypot(this.x - nextNode.worldX, this.y - nextNode.worldY) < 20) {
                    this.currentPath.shift()
                }
            }
        }

        const dx = finalTargetX - this.x
        const dy = finalTargetY - this.y
        const distToTarget = Math.hypot(dx, dy)

        const stopRadius = isHeal ? 2 : 10

        let vx = 0
        let vy = 0

        if (distToTarget > stopRadius) {
            const angleRad = Math.atan2(dy, dx)
            vx = Math.cos(angleRad) * PLAYER_SPEED * dt
            vy = Math.sin(angleRad) * PLAYER_SPEED * dt
        }

        const separatedVelocity = this.applySeparation(allBots, vx, vy, dt)

        this.x += separatedVelocity.x
        this.y += separatedVelocity.y
        this.vx = separatedVelocity.x / dt
        this.vy = separatedVelocity.y / dt

        if (Math.hypot(separatedVelocity.x, separatedVelocity.y) > 0.1) {
            if (this.state === BotState.ATTACK && distToPlayer < 400) {
                this.lookAt(targetX, targetY)
            }
            else {
                const movingAngle = Math.atan2(separatedVelocity.y, separatedVelocity.x)
                this.angle = (movingAngle * (180 / Math.PI)) + ANGLE_OFFSET
            }
        }
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
        const hasLOS = this.gridManager.hasLineOfSight(this.x, this.y, target.x, target.y)

        if (dist < 450 && hasLOS) {
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

        const directAngleRad = Math.atan2(target.y - this.y, target.x - this.x)

        const finalAngleRad = dist < 250 ? directAngleRad : predictedAngleRad

        const bulletData: iBullet = {
            id: `bullet-bot-${Math.random().toString(36).substring(2, 5)}`,
            playerId: this.id,
            x: this.x,
            y: this.y,
            vx: Math.cos(finalAngleRad) * BULLET_SPEED,
            vy: Math.sin(finalAngleRad) * BULLET_SPEED,
            angle: (finalAngleRad * (180 / Math.PI))
        }

        this.onShoot(bulletData)

        if (this.onRecordShot) {
            this.onRecordShot(bulletData, target)
        }

        this.lastShotTime = now
    }

    private applySeparation(allBots: Bot[], vx: number, vy: number, dt: number) {
        const MIN_DIST = PLAYER_RADIUS * 2.2
        let pushX = 0
        let pushY = 0

        allBots.forEach(other => {
            if (other.id === this.id) return

            const dx = this.x - other.x
            const dy = this.y - other.y
            const dist = Math.hypot(this.x - other.x, this.y - other.y)

            if (dist < MIN_DIST) {
                const angle = dist === 0 ? Math.random() * Math.PI * 2 : Math.atan2(dy, dx)

                const force = (MIN_DIST - dist) / MIN_DIST

                pushX += Math.cos(angle) * PLAYER_SPEED * force * 0.5 * dt
                pushY += Math.sin(angle) * PLAYER_SPEED * force * 0.5 * dt

                const dotProduct = (vx * -dx + vy * -dy) / (dist || 1)

                if (dotProduct > 0) {
                    vx *= 0.5
                    vy *= 0.5
                }
            }
        })

        return { x: vx + pushX, y: vy + pushY }
    }

    private doEvade(healPacks: iHealPack[], allBots: Bot[], target: iPlayer | null, dt: number) {
        const activeHeals = healPacks.filter(h => h.active)

        if (activeHeals.length === 0) {
            if (target) {
                const dx = this.x - target.x
                const dy = this.y - target.y
                const angleToRun = Math.atan2(dy, dx)

                const x = Math.max(0, Math.min(WORLD_WIDTH, this.x + Math.cos(angleToRun) * PLAYER_SPEED * dt))
                const y = Math.max(0, Math.min(WORLD_HEIGHT, this.y + Math.sin(angleToRun) * PLAYER_SPEED * dt))

                this.move(x, y, allBots, dt)
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

        this.move(closestHeal.x, closestHeal.y, allBots, dt, true)
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
        if (distance > 500) return false
        if (distance < 250 && relativeAngle < 0.17) return true

        if (!this.model) return true

        return tf.tidy(() => {
            const input = tf.tensor2d([[
                distance / 1000,
                target.vx / 5,
                target.vy / 5,
                relativeAngle / Math.PI
            ]])

            const prediction = this.model!.predict(input) as tf.Tensor
            const score = prediction.dataSync()[0]
            
            if (distance < 150) return score > 0.5

            return score > 0.75
        })
    }
}