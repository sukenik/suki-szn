import { GridManager, iGridNode } from './GridManager'

export class AStarPathfinder {
    private gridManager: GridManager

    constructor(gridManager: GridManager) {
        this.gridManager = gridManager
    }

    private getHeuristic(a: iGridNode, b: iGridNode): number {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
    }

    public findPath(
		startWorldX: number,
		startWorldY: number,
		targetWorldX: number,
		targetWorldY: number
	): iGridNode[] {
        const startPos = this.gridManager.worldToGrid(startWorldX, startWorldY)
        const targetPos = this.gridManager.worldToGrid(targetWorldX, targetWorldY)

        const startNode = this.gridManager.getNode(startPos.x, startPos.y)
        const targetNode = this.gridManager.getNode(targetPos.x, targetPos.y)

        if (!startNode || !targetNode || !targetNode.isWalkable) return []

        let openSet: iGridNode[] = [startNode]
        const closedSet = new Set<string>()
        const cameFrom = new Map<iGridNode, iGridNode>()

        const gScore = new Map<string, number>()
        const fScore = new Map<string, number>()

        const getScoreKey = (node: iGridNode) => `${node.x},${node.y}`

        gScore.set(getScoreKey(startNode), 0)
        fScore.set(getScoreKey(startNode), this.getHeuristic(startNode, targetNode))

        while (openSet.length > 0) {
            let currentIndex = 0

            for (let i = 1; i < openSet.length; i++) {
                const scoreI = fScore.get(getScoreKey(openSet[i])) ?? Infinity
                const scoreCurrent = fScore.get(getScoreKey(openSet[currentIndex])) ?? Infinity
                if (scoreI < scoreCurrent) {
                    currentIndex = i
                }
            }

            let current = openSet[currentIndex]
            const currentKey = getScoreKey(current)

            if (current.x === targetPos.x && current.y === targetPos.y) {
                return this.reconstructPath(cameFrom, current)
            }

            openSet.splice(currentIndex, 1)
            closedSet.add(currentKey)

            const neighbors = this.getNeighbors(current)

            for (const neighbor of neighbors) {
                const neighborKey = getScoreKey(neighbor)

                if (closedSet.has(neighborKey)) continue

                const tentativeGScore = (gScore.get(currentKey) || 0) + 1

                if (tentativeGScore < (gScore.get(neighborKey) || Infinity)) {
                    cameFrom.set(neighbor, current)
                    gScore.set(neighborKey, tentativeGScore)
                    fScore.set(neighborKey, tentativeGScore + this.getHeuristic(neighbor, targetNode))

                    if (!openSet.some(n => n.x === neighbor.x && n.y === neighbor.y)) {
                        openSet.push(neighbor)
                    }
                }
            }
        }

        return []
    }

    private getNeighbors(node: iGridNode): iGridNode[] {
        const neighbors: iGridNode[] = []
        const dirs = [
            { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
            { dx: 1, dy: 0 }, { dx: -1, dy: 0 }
        ]

        for (const dir of dirs) {
            const neighbor = this.gridManager.getNode(node.x + dir.dx, node.y + dir.dy)

            if (neighbor && neighbor.isWalkable) {
                neighbors.push(neighbor)
            }
        }
        return neighbors
    }

    private reconstructPath(cameFrom: Map<iGridNode, iGridNode>, current: iGridNode): iGridNode[] {
        const path = [current]

        while (cameFrom.has(current)) {
            current = cameFrom.get(current)!
            path.unshift(current)
        }
        return path
    }
}