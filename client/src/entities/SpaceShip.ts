import Phaser from 'phaser'
import { GAME_SETTINGS } from '../../../shared/consts'
import type { iPlayer } from '../../../shared/types'
import type { MainScene } from '../main'

const { MAX_HEALTH, PLAYER_SIZE } = GAME_SETTINGS

export class SpaceShip extends Phaser.GameObjects.Container {
    public hp: number
    public playerId: string
    public ship: Phaser.GameObjects.Sprite
    public emitter: Phaser.GameObjects.Particles.ParticleEmitter
    public healthBar: Phaser.GameObjects.Graphics
    public marker: Phaser.GameObjects.Arc
    public nameTag: Phaser.GameObjects.Text

    public targetX?: number
    public targetY?: number
    public targetRotation?: number

    constructor(
        scene: MainScene,
        x: number,
        y: number,
        playerInfo: iPlayer,
        isMainPlayer: boolean
    ) {
        super(scene, x, y)

        this.playerId = playerInfo.id
        this.hp = playerInfo.hp || MAX_HEALTH

        this.emitter = scene.add.particles(0, 0, 'bullet', {
            speed: 100,
            scale: { start: 0.5, end: 0 },
            alpha: { start: 1, end: 0 },
            lifespan: 300,
            tint: isMainPlayer ? 0xffaa00 : 0xff4400,
            emitting: false
        })

        this.ship = scene.add.sprite(0, 0, 'ship')
        this.ship.setDisplaySize(PLAYER_SIZE, PLAYER_SIZE)

        const isFriendlyColor = scene.getIsSurvival() && !playerInfo.id.includes('Bot')

        if (!isMainPlayer) {
            isFriendlyColor ? this.ship.setTint(0x00aaff) : this.ship.setTint(0xff0000)
        }

        this.nameTag = scene.add.text(0, -(PLAYER_SIZE / 2 + 25), playerInfo.name || 'Unknown', {
            fontSize: '14px',
            color: '#ffffff',
            backgroundColor: 'rgba(0,0,0,0.5)',
            padding: { x: 4, y: 2 }
        }).setOrigin(0.5)

        this.healthBar = scene.add.graphics()

        this.marker = scene.add.circle(
            0, 0, 50,
            isMainPlayer
                ? 0x00ff00
                : isFriendlyColor ? 0x00aaff : 0xff0000
        ).setDepth(100)

        this.add([this.emitter, this.ship, this.nameTag, this.healthBar, this.marker])
		this.sendToBack(this.emitter)

        this.setDepth(isMainPlayer ? 10 : 5)
        scene.cameras.main.ignore(this.marker)

        scene.add.existing(this)

        this.redrawHealthBar()

        if (scene.getIsMobile()) {
            this.setScale(1.7)
        }
    }

    public redrawHealthBar() {
        this.healthBar.clear()
        const xOffset = -20
        const yOffset = -30
        
        this.healthBar.fillStyle(0xff0000)
        this.healthBar.fillRect(xOffset, yOffset, 40, 5)

        this.healthBar.fillStyle(0x00ff00)
        const healthWidth = Phaser.Math.Clamp((this.hp / 100) * 40, 0, 40)
        this.healthBar.fillRect(xOffset, yOffset, healthWidth, 5)
    }

    public updateEmitter() {
        const angle = this.ship.rotation - Math.PI / 2
        const offset = 20

        this.emitter.setPosition(
            -Math.cos(angle) * offset,
            -Math.sin(angle) * offset
        )
        this.emitter.setAngle(this.ship.angle + 90)
    }

	public destroy(fromScene?: boolean) {
		if (this.emitter) this.emitter.destroy()
		super.destroy(fromScene)
	}
}