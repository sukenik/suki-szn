import { iPlayer } from '../../../shared/types'
import { GAME_SETTINGS } from '../../../shared/consts'
import { AStarPathfinder } from './AStarPathFinder'
import { GridManager, iGridNode } from './GridManager'

const { PLAYER_SPEED, TICK_RATE, MAX_HEALTH } = GAME_SETTINGS
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

    constructor(
        id: string, x: number, y: number, name: string, pathfinder: AStarPathfinder,
        gridManager: GridManager
    ) {
        this.id = id
        this.x = x
        this.y = y
        this.name = name
        this.pathfinder = pathfinder
        this.gridManager = gridManager
    }

    public update(allPlayers: { [id: string]: iPlayer }) {
        const target = this.findClosestTarget(allPlayers)

        if (target) {
            const distToTarget = Math.hypot(this.x - target.x, this.y - target.y)

            if (distToTarget < 60) {
                this.currentPath = []
                this.lookAt(target.x, target.y)
                return
            }

            this.handleNavigation(target)
            this.move(target)
        }
        else {
            this.currentPath = []
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

    private move(target: iPlayer) {
        const hasLOS = this.gridManager.hasLineOfSight(this.x, this.y, target.x, target.y)

        let targetX: number
        let targetY: number

        if (hasLOS) {
            targetX = target.x
            targetY = target.y
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
    
        let angleDeg = angleRad * (180 / Math.PI)

        this.angle = angleDeg + OFFSET

        const moveStep = PLAYER_SPEED / TICK_RATE
        this.x += Math.cos(angleRad) * moveStep
        this.y += Math.sin(angleRad) * moveStep
    }

    private lookAt(targetX: number, targetY: number) {
        const dx = targetX - this.x
        const dy = targetY - this.y
        
        const angleRad = Math.atan2(dy, dx)
        this.angle = (angleRad * (180 / Math.PI)) + OFFSET
    }
}