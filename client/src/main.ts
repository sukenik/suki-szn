import Phaser from 'phaser'
import { Socket } from 'socket.io-client'
import { GAME_SETTINGS, GAME_EVENTS } from '../../shared/consts'
import type { iBullet, iPlayer } from '../../shared/types'
import { SpaceShip } from './entities/SpaceShip'
import type { iBulletSprite } from './entities/types'

const { WORLD_WIDTH, WORLD_HEIGHT, PLAYER_SIZE, MAX_HEALTH } = GAME_SETTINGS

export class MainScene extends Phaser.Scene {
    private socket!: Socket
    private playerContainer!: SpaceShip
    private otherPlayers!: Phaser.GameObjects.Group
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
    private bullets!: Phaser.Physics.Arcade.Group
    private leaderboardText!: Phaser.GameObjects.Text
    private starfield!: Phaser.GameObjects.TileSprite
    private minimap!: Phaser.Cameras.Scene2D.Camera
    private minimapBorder!: Phaser.GameObjects.Graphics
    private lastSentPosition = { x: 0, y: 0, angle: 0 }

    constructor() {
        super('MainScene')
    }

    preload() {
        this.load.image('ship', 'https://labs.phaser.io/assets/sprites/fmship.png')
        this.load.image('bullet', 'https://labs.phaser.io/assets/sprites/bullets/bullet7.png')
        this.load.image('stars', 'assets/stars.png')
    }

    create() {
        this.socket = this.game.registry.get('socket')

        const MAP_SIZE = 200
        const MAP_MARGIN = 20

        this.setupGroups()
        this.setupPhysics()
        this.setupBackground()
        this.setupMinimap(MAP_SIZE, MAP_MARGIN)
        this.setupControls()
        this.setupNetworkEvents()
        this.setupLeaderboard()

        this.scale.on('resize', () => {
            if (this.starfield) {
                this.starfield.setSize(this.scale.width, this.scale.height)
            }
            this.updateMinimapLayout(MAP_SIZE, MAP_MARGIN)
        })

        this.socket = this.game.registry.get('socket')

        const attemptRequest = () => {
            if (this.socket.connected) {
                this.socket.emit(GAME_EVENTS.REQUEST_INITIAL_STATE)
            }
        }

        attemptRequest()

        this.time.delayedCall(2000, () => {
            if (!this.playerContainer) {
                attemptRequest()
            }
        })

        this.cameras.main.ignore(this.add.group())
    }

    addMainPlayer(playerInfo: iPlayer) {
        if (this.playerContainer) this.playerContainer.destroy()

        const container = new SpaceShip(this, playerInfo.x, playerInfo.y, playerInfo, true)
        this.playerContainer = container

        this.physics.world.enable(container)
        const body = container.body as Phaser.Physics.Arcade.Body
        body.setCollideWorldBounds(true)
        body.setSize(PLAYER_SIZE, PLAYER_SIZE)
        body.setOffset(-PLAYER_SIZE / 2, -PLAYER_SIZE / 2)

        this.cameras.main.startFollow(container, true, 0.1, 0.1)
        
        if (this.minimap) {
            this.minimap.ignore([container.nameTag, container.healthBar])
        }
    }

    addOtherPlayer(playerInfo: iPlayer) {
        const otherPlayer = new SpaceShip(this, playerInfo.x, playerInfo.y, playerInfo, false)

        this.physics.world.enable(otherPlayer)

        if (otherPlayer.body instanceof Phaser.Physics.Arcade.Body) {
            otherPlayer.body.setCollideWorldBounds(true)
            otherPlayer.body.setSize(PLAYER_SIZE, PLAYER_SIZE)
            otherPlayer.body.setOffset(-PLAYER_SIZE / 2, -PLAYER_SIZE / 2)
        }

        if (this.minimap) {
            this.minimap.ignore([otherPlayer.nameTag, otherPlayer.healthBar])
        }

        this.otherPlayers.add(otherPlayer)
    }

    update() {
        if (this.starfield) {
            this.starfield.tilePositionX = this.cameras.main.scrollX * 0.2
            this.starfield.tilePositionY = this.cameras.main.scrollY * 0.2
        }

        if (!this.playerContainer || !this.cursors) return

        const body = this.playerContainer.body as Phaser.Physics.Arcade.Body
        const speed = 200

        if (this.cursors.left.isDown) body.setVelocityX(-speed)
        else if (this.cursors.right.isDown) body.setVelocityX(speed)
        else body.setVelocityX(0)

        if (this.cursors.up.isDown) body.setVelocityY(-speed)
        else if (this.cursors.down.isDown) body.setVelocityY(speed)
        else body.setVelocityY(0)

        const isMoving = body.velocity.x !== 0 || body.velocity.y !== 0

        if (isMoving) {
            const newAngle = Math.atan2(body.velocity.y, body.velocity.x)
            this.playerContainer.ship.setRotation(newAngle + Math.PI / 2)

            this.playerContainer.updateEmitter()

            if (!this.playerContainer.emitter.emitting) this.playerContainer.emitter.start()
        } else {
            this.playerContainer.emitter.stop()
        }

        if (
            this.lastSentPosition.x !== this.playerContainer.x || 
            this.lastSentPosition.y !== this.playerContainer.y || 
            this.lastSentPosition.angle !== this.playerContainer.ship.angle
        ) {
            this.socket.emit(GAME_EVENTS.PLAYER_MOVEMENT, {
                x: this.playerContainer.x,
                y: this.playerContainer.y,
                angle: this.playerContainer.ship.angle
            })

            this.lastSentPosition = {
                x: this.playerContainer.x,
                y: this.playerContainer.y,
                angle: this.playerContainer.ship.angle
            }
        }

        this.playerContainer.redrawHealthBar()

        this.otherPlayers.getChildren().forEach(obj => {
            const otherPlayer = obj as SpaceShip

            if (otherPlayer.targetX !== undefined && otherPlayer.targetY !== undefined) {
                otherPlayer.x = Phaser.Math.Linear(otherPlayer.x, otherPlayer.targetX, 0.2)
                otherPlayer.y = Phaser.Math.Linear(otherPlayer.y, otherPlayer.targetY, 0.2)

                const targetRad = Phaser.Math.DegToRad(otherPlayer.targetRotation || 0)
                otherPlayer.ship.rotation = Phaser.Math.Angle.RotateTo(otherPlayer.ship.rotation, targetRad, 0.1)

                const distanceMoved = Phaser.Math.Distance.Between(otherPlayer.x, otherPlayer.y, otherPlayer.targetX, otherPlayer.targetY)
                
                if (distanceMoved > 0.5) {
                    otherPlayer.updateEmitter()
                    if (!otherPlayer.emitter.emitting) otherPlayer.emitter.start()
                } else {
                    otherPlayer.emitter.stop()
                }
            }

            otherPlayer.redrawHealthBar()
        })
    }

    shoot(pointer: Phaser.Input.Pointer) {
        if (!this.playerContainer || !this.socket.id) return

        const container = this.playerContainer

        const angleInRadians = Phaser.Math.Angle.Between(
            container.x,
            container.y,
            pointer.x + this.cameras.main.scrollX,
            pointer.y + this.cameras.main.scrollY
        )

        const speed = 600
        const vx = Math.cos(angleInRadians) * speed
        const vy = Math.sin(angleInRadians) * speed

        const tempId = 'local_' + Date.now()
        this.createBullet({
            id: tempId,
            playerId: this.socket.id,
            x: container.x,
            y: container.y,
            vx: vx,
            vy: vy,
            angle: Phaser.Math.RadToDeg(angleInRadians)
        })

        this.socket.emit(GAME_EVENTS.PLAYER_SHOOT, {
            vx,
            vy,
            x: this.playerContainer.x,
            y: this.playerContainer.y
        })
    }

    createBullet(bulletData: iBullet) {
        const bullet = this.bullets.create(bulletData.x, bulletData.y, 'bullet') as iBulletSprite
        const body = bullet.body as Phaser.Physics.Arcade.Body

        if (body) {
            bullet.bulletId = bulletData.id
            bullet.setAngle(bulletData.angle)
            body.setVelocity(bulletData.vx, bulletData.vy)

            bullet.setCollideWorldBounds(true)
            body.onWorldBounds = true

            body.world.on('worldbounds', (body: Phaser.Physics.Arcade.Body) => {
                if (body && body.gameObject) {
                    body.gameObject.destroy()
                }
            })
        }
    }

    private setupGroups = () => {
        this.otherPlayers = this.add.group()
        this.bullets = this.physics.add.group()
    }

    private setupPhysics = () => {
        this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
        
        this.physics.add.overlap(this.bullets, [], (_, bulletObj) => {
            const bullet = bulletObj as iBulletSprite
            this.createBulletImpact(bullet.x, bullet.y)
            bullet.destroy()
        })

        this.cameras.main.setRoundPixels(true)
    }

    private setupBackground = () => {
        this.starfield = this.add.tileSprite(0, 0, window.innerWidth, window.innerHeight, 'stars')
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(-1)
    }

    private setupMinimap = (mapSize: number, margin: number) => {
        if (!this.minimap) {
            this.minimap = this.cameras.add(0, 0, mapSize, mapSize).setName('mini')
        }

        const zoom = mapSize / WORLD_WIDTH 
        this.minimap.setZoom(zoom)
        this.minimap.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2)
        this.minimap.setBackgroundColor(0x000000)
        this.minimap.inputEnabled = false

        if (!this.minimapBorder) {
            this.minimapBorder = this.add.graphics().setScrollFactor(0).setDepth(2000)
        }

        this.updateMinimapLayout(mapSize, margin)

        if (this.starfield) this.minimap.ignore(this.starfield)
    }

    private updateMinimapLayout = (mapSize: number, margin: number) => {
        const x = this.scale.width - mapSize - margin
        const y = margin

        if (this.minimap) {
            this.minimap.setPosition(x, y)
        }

        if (this.minimapBorder) {
            this.minimapBorder.clear()
            this.minimapBorder.lineStyle(2, 0xffffff, 0.8)
            this.minimapBorder.strokeRect(x, y, mapSize, mapSize)
        }
    }

    private setupControls = () => {
        if (this.input.keyboard) {
            this.cursors = this.input.keyboard.createCursorKeys()
        }
        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.shoot(pointer))
    }

    private setupLeaderboard = () => {
        this.leaderboardText = this.add.text(10, 10, ' Loading Leaderboard...', {
            fontSize: '18px',
            fontFamily: 'Courier, monospace',
            color: '#ffffff',
            backgroundColor: 'rgba(0,0,0,0.5)',
            padding: { x: 10, y: 5 }
        }).setScrollFactor(0).setDepth(1000)
        
        if (this.minimap) this.minimap.ignore(this.leaderboardText)
    }

    private createExplosion = (x: number, y: number) => {
        const explosion = this.add.particles(x, y, 'bullet', {
            speed: { min: 50, max: 150 },
            angle: { min: 0, max: 360 },
            scale: { start: 1, end: 0 },
            alpha: { start: 1, end: 0 },
            tint: [0xff0000, 0xffaa00, 0xffffff],
            lifespan: 600,
            gravityY: 0,
            blendMode: 'ADD',
            emitting: false
        })

        explosion.explode(40)

        this.time.delayedCall(600, () => {
            explosion.destroy()
        })
    }

    private createBulletImpact = (x: number, y: number) => {
        const sparks = this.add.particles(x, y, 'bullet', {
            speed: { min: 20, max: 100 },
            angle: { min: 0, max: 360 },
            scale: { start: 0.3, end: 0 },
            alpha: { start: 1, end: 0 },
            tint: 0xffff00,
            lifespan: 200,
            blendMode: 'ADD',
            emitting: false
        })

        sparks.explode(10)

        this.time.delayedCall(200, () => {
            sparks.destroy()
        })
    }
    
    private handleBulletHit = (bulletId: string) => {
        const bullets = this.bullets.getChildren() as iBulletSprite[]

        bullets.forEach(bullet => {
            if (bullet.bulletId === bulletId) {
                bullet.destroy()
            }
        })
    }

    private setupNetworkEvents = () => {
        this.socket.on(GAME_EVENTS.CURRENT_PLAYERS, (players: { [id: string]: iPlayer }) => {
            if (this.otherPlayers) this.otherPlayers.clear(true, true)

            Object.keys(players).forEach((id) => {
                if (id === this.socket.id) {
                    this.addMainPlayer(players[id])
                } else {
                    this.addOtherPlayer(players[id])
                }
            })
        })

        this.socket.on(GAME_EVENTS.PLAYER_JOINED, (playerInfo: iPlayer) => {
            this.addOtherPlayer(playerInfo)
        })

        this.socket.on(GAME_EVENTS.PLAYER_MOVED, (playerInfo: iPlayer) => {
            this.otherPlayers.getChildren().forEach(obj => {
                const otherPlayer = obj as SpaceShip

                if (playerInfo.id === otherPlayer.playerId) {
                    otherPlayer.targetX = playerInfo.x
                    otherPlayer.targetY = playerInfo.y
                    otherPlayer.targetRotation = playerInfo.angle
                }
            })
        })

        this.socket.on(GAME_EVENTS.PLAYER_HIT, (data: { playerId: string, hp: number, bulletId: string }) => {
            this.handlePlayerHit(data)
        })

        this.socket.on(GAME_EVENTS.LEADERBOARD_UPDATE, (data: { username: string, high_score: number }[]) => {
            let text = '🏆 TOP PILOTS\n\n'

            data.forEach((player, index) => {
                const name = player.username || 'Unknown'
                const score = player.high_score || 0

                const rank = `${index + 1}.`.padEnd(3)
                text += `${rank} ${name.padEnd(20)} ${score}\n`
            })
            this.leaderboardText.setText(text)
        })

        this.socket.on(GAME_EVENTS.PLAYER_LEFT, (playerId: string) => {
            this.otherPlayers.getChildren().forEach(obj => {
                const otherPlayer = obj as SpaceShip

                if (playerId === otherPlayer.playerId) {
                    otherPlayer.destroy()
                }
            })
        })

        this.socket.on(GAME_EVENTS.NEW_BULLET, (bulletData: iBullet) => {
            if (bulletData.playerId === this.socket.id) {
                const bullets = this.bullets.getChildren() as iBulletSprite[]
                const localBullet = bullets.find(b => b.bulletId.startsWith('local_'))

                if (localBullet) {
                    localBullet.bulletId = bulletData.id
                }

                return
            }

            this.createBullet(bulletData)
        })
        
        this.socket.on(GAME_EVENTS.PLAYER_DIED, (data: { playerId: string, newX: number, newY: number, bulletId: string }) => {
            let deadPlayer: SpaceShip | null = null

            if (data.playerId === this.socket.id && this.playerContainer) {
                deadPlayer = this.playerContainer
                this.cameras.main.flash(500, 255, 0, 0)
            } else {
                this.otherPlayers.getChildren().forEach(obj => {
                    const otherPlayer = obj as SpaceShip
                    if (otherPlayer.playerId === data.playerId) deadPlayer = otherPlayer
                })
            }

            if (deadPlayer) {
                this.createExplosion(deadPlayer.x, deadPlayer.y)
                
                deadPlayer.hp = MAX_HEALTH
                deadPlayer.setPosition(data.newX, data.newY)
                deadPlayer.redrawHealthBar()

                if (data.playerId !== this.socket.id) {
                    deadPlayer.targetX = data.newX
                    deadPlayer.targetY = data.newY
                }
            }

            this.handleBulletHit(data.bulletId)
        })
    }
    
    private handlePlayerHit = (data: { playerId: string, hp: number, bulletId: string }) => {
        let targetPlayer: SpaceShip | null = null

        if (data.playerId === this.socket.id) {
            targetPlayer = this.playerContainer
        } else {
            this.otherPlayers.getChildren().forEach(obj => {
                const otherPlayer = obj as SpaceShip
                if (otherPlayer.playerId === data.playerId) targetPlayer = otherPlayer
            })
        }

        if (targetPlayer) {
            targetPlayer.hp = data.hp
            targetPlayer.redrawHealthBar()
            
            targetPlayer.ship.setTint(0xffffff) 

            this.time.delayedCall(100, () => {
                if (!targetPlayer) return
                targetPlayer.playerId === this.socket.id
                    ? targetPlayer.ship.clearTint()
                    : targetPlayer.ship.setTint(0xff0000)
            })
            
            this.createBulletImpact(targetPlayer.x, targetPlayer.y)
        }

        this.handleBulletHit(data.bulletId)
    }
}