import { iCircleObstacle, iCompoundRectObstacle, iRectObstacle } from "../../../shared/types"

export interface iGridNode {
    x: number
    y: number
    worldX: number
    worldY: number
    isWalkable: boolean
}

export class GridManager {
	private grid: iGridNode[][] = []
    private cellSize: number
    private cols: number
    private rows: number

	constructor(worldWidth: number, worldHeight: number, cellSize: number) {
        this.cellSize = cellSize
        this.cols = Math.floor(worldWidth / cellSize)
        this.rows = Math.floor(worldHeight / cellSize)
        this.generateGrid()
    }

	private generateGrid() {
        for (let y = 0; y < this.rows; y++) {
            this.grid[y] = []

            for (let x = 0; x < this.cols; x++) {
                this.grid[y][x] = {
                    x,
                    y,
                    worldX: x * this.cellSize + this.cellSize / 2,
                    worldY: y * this.cellSize + this.cellSize / 2,
                    isWalkable: true
                }
            }
        }
    }

	public worldToGrid(worldX: number, worldY: number): { x: number, y: number } {
        const x = Math.max(0, Math.min(this.cols - 1, Math.floor(worldX / this.cellSize)))
        const y = Math.max(0, Math.min(this.rows - 1, Math.floor(worldY / this.cellSize)))

        return { x, y }
    }

	public getNode(x: number, y: number): iGridNode | null {
        if (y >= 0 && y < this.rows && x >= 0 && x < this.cols) {
            return this.grid[y][x]
        }

        return null
    }

    public getGrid() {
        return this.grid
    }

    public addRectObstacle(rectObstacle: iRectObstacle) {
		const { worldX, worldY, width, height } = rectObstacle

        const topLeft = this.worldToGrid(worldX, worldY)
        const bottomRight = this.worldToGrid(worldX + width, worldY + height)

        for (let y = topLeft.y; y <= bottomRight.y; y++) {
            for (let x = topLeft.x; x <= bottomRight.x; x++) {
                const node = this.getNode(x, y)
                if (node) node.isWalkable = false
            }
        }
    }

    public addCircleObstacle(circleObstacle: iCircleObstacle) {
		const { worldX: centerX, worldY: centerY, radius } = circleObstacle

        const topLeft = this.worldToGrid(centerX - radius, centerY - radius)
        const bottomRight = this.worldToGrid(centerX + radius, centerY + radius)

        for (let y = topLeft.y; y <= bottomRight.y; y++) {
            for (let x = topLeft.x; x <= bottomRight.x; x++) {
                const node = this.getNode(x, y)
                if (node) {
                    const dist = Math.hypot(node.worldX - centerX, node.worldY - centerY)
                    if (dist <= radius) {
                        node.isWalkable = false
                    }
                }
            }
        }
    }

    public addCompoundRectObstacle(compound: iCompoundRectObstacle) {
        compound.rects.forEach(subRect => {
            const absX = compound.worldX + subRect.x
            const absY = compound.worldY + subRect.y

            const topLeft = this.worldToGrid(absX, absY)
            const bottomRight = this.worldToGrid(absX + subRect.w, absY + subRect.h)

            for (let y = topLeft.y; y <= bottomRight.y; y++) {
                for (let x = topLeft.x; x <= bottomRight.x; x++) {
                    const node = this.getNode(x, y)
                    if (node) node.isWalkable = false
                }
            }
        })
    }
}