import { GAME_SETTINGS } from '../../../shared/consts'
import { iBullet, iHealPack, iPlayer } from '../../../shared/types'
import { AStarPathfinder } from './AStarPathfinder'
import { GridManager, iGridNode } from './GridManager'

enum BotState {
    CHASE,
    ATTACK,
    EVADE
}

type ShootCallback = (bulletData: iBullet) => void

const { PLAYER_SPEED, TICK_RATE, MAX_HEALTH, BULLET_SPEED } = GAME_SETTINGS
const OFFSET = 90

export class Bot implements iPlayer {
    public id: string
    public x: number
    public y: number
    public angle: number = 0
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
    private lastShotTime: number = 0
    private readonly SHOOT_COOLDOWN = 1000

    constructor(
        id: string, x: number, y: number, name: string, pathfinder: AStarPathfinder,
        gridManager: GridManager, onShoot: ShootCallback
    ) {
        this.id = id
        this.x = x
        this.y = y
        this.name = name
        this.pathfinder = pathfinder
        this.gridManager = gridManager
        this.onShoot = onShoot
    }

    public update(allPlayers: { [id: string]: iPlayer }, healPacks: iHealPack[]) {
        const target = this.findClosestTarget(allPlayers)
        const allBots = Object.values(allPlayers).filter(
            player => (player as Bot).isBot
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
                    this.lookAt(target.x, target.y)

                    const sep = this.applySeparation(allBots, 0, 0)
                    this.x += sep.x
                    this.y += sep.y

                    if (this.canShootSafely(allBots)) {
                        this.shoot()
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

            if ((p as any).isBot || p.id === this.id) continue

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
            if (this.currentPath.length < 2) return

            const nextNode = this.currentPath[1]
            targetX = nextNode.worldX
            targetY = nextNode.worldY

            if (Math.hypot(targetX - this.x, targetY - this.y) < 10) {
                this.currentPath.shift()
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

        this.angle = (finalAngleRad * (180 / Math.PI)) + OFFSET

        this.x += separatedVelocity.x
        this.y += separatedVelocity.y
    }

    private lookAt(targetX: number, targetY: number) {
        const dx = targetX - this.x
        const dy = targetY - this.y
        
        const angleRad = Math.atan2(dy, dx)
        this.angle = (angleRad * (180 / Math.PI)) + OFFSET
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

    private shoot() {
        const now = Date.now()
        if (now - this.lastShotTime < this.SHOOT_COOLDOWN) return

        const shootAngle = (this.angle - OFFSET) * (Math.PI / 180)

        const bulletData: iBullet = {
            id: `bullet-bot-${Math.random().toString(36).substr(2, 5)}`,
            playerId: this.id,
            x: this.x,
            y: this.y,
            vx: Math.cos(shootAngle) * BULLET_SPEED,
            vy: Math.sin(shootAngle) * BULLET_SPEED,
            angle: this.angle - OFFSET
        }

        this.onShoot(bulletData)
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

    private canShootSafely(allBots: Bot[]): boolean {
        const shootAngleRad = (this.angle - OFFSET) * (Math.PI / 180)
        
        for (const other of allBots) {
            if (other.id === this.id) continue

            const dx = other.x - this.x
            const dy = other.y - this.y
            const dist = Math.hypot(dx, dy)

            if (dist < 400) {
                const angleToOther = Math.atan2(dy, dx)
            
                let diff = Math.abs(shootAngleRad - angleToOther)
                if (diff > Math.PI) diff = Math.PI * 2 - diff

                if (diff < 0.25) { 
                    return false
                }
            }
        }

        return true
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
}