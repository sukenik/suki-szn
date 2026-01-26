import Phaser from 'phaser'
import { Socket } from 'socket.io-client'
import { GAME_EVENTS, GAME_SETTINGS } from '../../shared/consts'
import type { iBullet, iCircleObstacle, iCompoundRectObstacle, iPlayer, iRectObstacle, iServerUpdateData, ObstaclesType } from '../../shared/types'
import { SpaceShip } from './entities/SpaceShip'
import type { iBulletSprite } from './entities/types'

const {
    WORLD_WIDTH, WORLD_HEIGHT, PLAYER_SIZE, MAX_HEALTH, PLAYER_SPEED,
    TICK_RATE, PLAYER_RADIUS
} = GAME_SETTINGS

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
    private heals!: Phaser.Physics.Arcade.Group
    private obstacles: ObstaclesType = []

    constructor() {
        super('MainScene')
    }

    preload() {
        this.load.image('ship', 'https://labs.phaser.io/assets/sprites/fmship.png')
        this.load.image('bullet', 'https://labs.phaser.io/assets/sprites/bullets/bullet7.png')
        this.load.image('stars', 'assets/stars.png')
        this.load.image('heal_icon', 'https://labs.phaser.io/assets/sprites/firstaid.png')
        this.load.image('planet', 'assets/planet15.png')
        this.load.image('ship_wall', 'assets/satellite.png')
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

        const vx = (this.cursors.right.isDown ? 1 : 0) - (this.cursors.left.isDown ? 1 : 0)
        const vy = (this.cursors.down.isDown ? 1 : 0) - (this.cursors.up.isDown ? 1 : 0)
        
        let movementAngle = this.playerContainer.ship.angle

        if (vx !== 0 || vy !== 0) {
            movementAngle = (Math.atan2(vy, vx) * (180 / Math.PI))
            this.playerContainer.ship.angle = (Math.atan2(vy, vx) * (180 / Math.PI)) + 90
        }

        const currentInputs = {
            up: this.cursors.up.isDown,
            down: this.cursors.down.isDown,
            left: this.cursors.left.isDown,
            right: this.cursors.right.isDown,
            angle: movementAngle,
            shoot: false
        }

        const moveStep = PLAYER_SPEED / TICK_RATE
        let nextX = this.playerContainer.x
        let nextY = this.playerContainer.y

        if (currentInputs.up)    nextY -= moveStep
        if (currentInputs.down)  nextY += moveStep
        if (currentInputs.left)  nextX -= moveStep
        if (currentInputs.right) nextX += moveStep
        
        if (!this.checkCollision(nextX, nextY)) {
            this.playerContainer.x = nextX
            this.playerContainer.y = nextY
        }

        this.socket.emit(GAME_EVENTS.INPUT_UPDATE, currentInputs)

        const isMoving = currentInputs.up || currentInputs.down || currentInputs.left || currentInputs.right

        if (isMoving) {
            this.playerContainer.updateEmitter()
            if (!this.playerContainer.emitter.emitting) this.playerContainer.emitter.start()
        } else {
            this.playerContainer.emitter.stop()
        }

        this.playerContainer.redrawHealthBar()

        this.otherPlayers.getChildren().forEach(obj => {
            const otherPlayer = obj as SpaceShip

            if (otherPlayer.targetX !== undefined && otherPlayer.targetY !== undefined) {
                otherPlayer.x = Phaser.Math.Linear(otherPlayer.x, otherPlayer.targetX, 0.2)
                otherPlayer.y = Phaser.Math.Linear(otherPlayer.y, otherPlayer.targetY, 0.2)

                if (otherPlayer.targetRotation !== undefined) {
                    const targetRad = Phaser.Math.DegToRad(otherPlayer.targetRotation)
                    
                    otherPlayer.ship.rotation = Phaser.Math.Angle.RotateTo(
                        otherPlayer.ship.rotation, 
                        targetRad, 
                        0.15
                    )
                }

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

        this.bullets.getChildren().forEach(bulletObj => {
            const bullet = bulletObj as iBulletSprite

            const isColliding = this.checkCollision(bullet.x, bullet.y)

            if (isColliding) {
                bullet.destroy()
            }
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

        const vx = Math.cos(angleInRadians) * PLAYER_SPEED
        const vy = Math.sin(angleInRadians) * PLAYER_SPEED

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
        this.heals = this.physics.add.group()
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
    
    private setupObstacles(obstacles: ObstaclesType) {
        obstacles.forEach(obs => {
            if (obs.type === 'circle') {
                const { worldX, worldY, radius } = obs as iCircleObstacle

                const asteroid = this.add.sprite(worldX, worldY, 'planet')
                asteroid.setDisplaySize(radius * 2.4, radius * 2.4)
                asteroid.setDepth(2)
            }
            else if (obs.type === 'rect') {
                const { worldX, worldY, width, height } = obs as iRectObstacle

                const wall = this.add.image(worldX, worldY, 'ship_wall')
                wall.setOrigin(0, 0)
                wall.setDisplaySize(width, height)
                wall.setDepth(2)
            }
            else if (obs.type === 'compound_rect') {
                const { worldX, worldY } = obs as iCompoundRectObstacle

                const shipImg = this.add.image(worldX, worldY, 'ship_wall')
                shipImg.setOrigin(0, 0)
                shipImg.setDisplaySize(150, 335) 
                shipImg.setDepth(2)
            }
        })
    }

    private checkCollision = (nx: number, ny: number): boolean => {
        for (const obs of this.obstacles) {
            if (obs.type === 'circle') {
                const dist = Math.hypot(nx - obs.worldX, ny - obs.worldY)

                if (dist < (obs as iCircleObstacle).radius + PLAYER_RADIUS) return true
            }
            else if (obs.type === 'rect') {
                const { worldX, worldY, width, height } = obs as iRectObstacle

                if (
                    nx + PLAYER_RADIUS > worldX
                    && nx - PLAYER_RADIUS < worldX + width
                    && ny + PLAYER_RADIUS > worldY
                    && ny - PLAYER_RADIUS < worldY + height
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
                        nx + PLAYER_RADIUS > absX
                        && nx - PLAYER_RADIUS < absX + subRect.w
                        && ny + PLAYER_RADIUS > absY
                        && ny - PLAYER_RADIUS < absY + subRect.h
                    ) {
                        return true
                    }
                }
            }
        }

        return false
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

        this.socket.on(GAME_EVENTS.SERVER_UPDATE, (data: iServerUpdateData) => {
            Object.keys(data.players).forEach(id => {
                const serverPlayerData = data.players[id]

                if (id === this.socket.id && this.playerContainer) {
                    const dist = Phaser.Math.Distance.Between(
                        this.playerContainer.x,
                        this.playerContainer.y,
                        serverPlayerData.x,
                        serverPlayerData.y
                    )
                    if (dist > 10) {
                        this.playerContainer.x = Phaser.Math.Linear(this.playerContainer.x, serverPlayerData.x, 0.1)
                        this.playerContainer.y = Phaser.Math.Linear(this.playerContainer.y, serverPlayerData.y, 0.1)
                    }

                    this.playerContainer.hp = serverPlayerData.hp
                    this.playerContainer.redrawHealthBar()
                } 
                else {
                    let otherPlayer: SpaceShip | undefined
                    this.otherPlayers.getChildren().forEach(obj => {
                        const p = obj as SpaceShip
                        if (p.playerId === id) otherPlayer = p
                    })

                    if (otherPlayer) {
                        otherPlayer.targetX = serverPlayerData.x
                        otherPlayer.targetY = serverPlayerData.y
                        otherPlayer.targetRotation = (serverPlayerData.angle + 90)
                        otherPlayer.hp = serverPlayerData.hp
                    }
                }
            })

            data.heals.forEach(healData => {
                const healSprites = this.heals.getChildren() as Phaser.GameObjects.Sprite[]
                let healSprite = healSprites.find(h => h.getData('healId') === healData.id)

                if (!healSprite) {
                    healSprite = this.heals.create(healData.x, healData.y, 'heal_icon') as Phaser.GameObjects.Sprite
                    healSprite.setData('healId', healData.id)
                    healSprite.setScale(0.8)
                    healSprite.setTint(0x00ff00)
                }

                healSprite.setPosition(healData.x, healData.y)
                healSprite.setActive(healData.active)
                healSprite.setVisible(healData.active)
            })
        })

        this.socket.on(GAME_EVENTS.INITIAL_OBSTACLES, (obstacles: ObstaclesType) => {
            this.obstacles = obstacles
            this.setupObstacles(obstacles)
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