import Phaser from 'phaser'
import { Socket } from 'socket.io-client'
import { GAME_EVENTS, GAME_SETTINGS } from '../../shared/consts'
import type { iBullet, iCircleObstacle, iCompoundRectObstacle, iLeaderboardUpdate, iSurvivalLeaderboardUpdate, iPlayer, iPlayerInputs, iRectObstacle, iServerUpdateData, ObstaclesType } from '../../shared/types'
import { SpaceShip } from './entities/SpaceShip'
import type { iBulletSprite } from './entities/types'

const {
    WORLD_WIDTH, WORLD_HEIGHT, PLAYER_SIZE, MAX_HEALTH, PLAYER_SPEED,
    PLAYER_RADIUS, BULLET_SPEED, ANGLE_OFFSET
} = GAME_SETTINGS

export class MainScene extends Phaser.Scene {
    private socket!: Socket
    private playerContainer!: SpaceShip
    private otherPlayers!: Phaser.GameObjects.Group
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
    private bullets!: Phaser.Physics.Arcade.Group
    private rankColumn!: Phaser.GameObjects.Text
    private nameColumn!: Phaser.GameObjects.Text
    private scoreColumn!: Phaser.GameObjects.Text
    private starfield!: Phaser.GameObjects.TileSprite
    private minimap!: Phaser.Cameras.Scene2D.Camera
    private minimapBorder!: Phaser.GameObjects.Graphics
    private heals!: Phaser.Physics.Arcade.Group
    private uiCamera!: Phaser.Cameras.Scene2D.Camera
    private backgroundCamera!: Phaser.Cameras.Scene2D.Camera
    private uiGroup!: Phaser.GameObjects.Group
    private obstaclesGroup!: Phaser.GameObjects.Group

    private obstacles: ObstaclesType = []
    private isMobile: boolean = false
    private currentMapSize: number = 200
    private readonly MAP_MARGIN: number = 15
    private readonly JOYSTICK_RADIUS: number = 80
    private joystickVector: Phaser.Math.Vector2 = new Phaser.Math.Vector2(0, 0)
    private isDead: boolean = false
    private spectatorIndex: number = 0
    private isSurvival = false

    private joystickBase?: Phaser.GameObjects.Arc
    private joystickThumb?: Phaser.GameObjects.Arc
    private joystickPointer?: Phaser.Input.Pointer
    private deathOverlay?: Phaser.GameObjects.Rectangle
    private deathText?: Phaser.GameObjects.Text
    private respawnTimerText?: Phaser.GameObjects.Text
    private specLeftBtn?: Phaser.GameObjects.Text
    private specRightBtn?: Phaser.GameObjects.Text
    private spectatorNameText?: Phaser.GameObjects.Text
    private waveTextDisplay?: Phaser.GameObjects.Text

    public getIsMobile = () => this.isMobile
    public getIsSurvival = () => this.isSurvival

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
        this.isMobile = this.scale.width < 1000

        if (this.isMobile) {
            this.currentMapSize = 120
            this.cameras.main.setZoom(0.5)
        }

        this.backgroundCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height)
        this.backgroundCamera.setScroll(0, 0)

        this.setupGroups()
        this.setupPhysics()
        this.setupBackground()
        this.setupMinimap(this.currentMapSize, this.MAP_MARGIN)
        this.setupControls()
        this.isMobile && this.setupMobileControls()
        this.setupNetworkEvents()
        this.setupLeaderboard()
        this.setupCameras()

        this.events.on('postupdate', () => {
            if (this.playerContainer && !this.isDead) {
                const targetX = this.playerContainer.x - this.cameras.main.width / 2
                const targetY = this.playerContainer.y - this.cameras.main.height / 2
                
                this.cameras.main.scrollX = targetX
                this.cameras.main.scrollY = targetY
            }
        })

        this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
            const { width, height } = gameSize

            if (this.uiCamera) this.uiCamera.setViewport(0, 0, width, height)
            if (this.backgroundCamera) this.backgroundCamera.setViewport(0, 0, width, height)

            this.cameras.main.setViewport(0, 0, width, height)

            this.updateMinimapLayout(this.currentMapSize, this.MAP_MARGIN)

            if (this.isMobile && this.joystickBase && this.joystickThumb) {
                const x = 100
                const y = this.scale.height - 100
                this.joystickBase.setPosition(x, y)
                this.joystickThumb.setPosition(x, y)
            }

            if (this.starfield) {
                this.starfield.setSize(width, height)
            }
        })

        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                this.scale.resize(window.innerWidth, window.innerHeight)
            }, 500)
        })

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

        if (this.minimap) {
            this.minimap.ignore([container.nameTag, container.healthBar])
        }

        if (this.uiCamera) this.uiCamera.ignore(container)
        if (this.backgroundCamera) this.backgroundCamera.ignore(container)
    }

    addOtherPlayer(playerInfo: iPlayer) {
        if (!playerInfo) return

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

        if (this.uiCamera) this.uiCamera.ignore(otherPlayer)
        if (this.backgroundCamera) this.backgroundCamera.ignore(otherPlayer)
    }

    update(_: number, delta: number) {
        const dt = delta / 1000

        if (this.starfield) {
            this.starfield.tilePositionX = Math.floor(this.cameras.main.scrollX * 0.2)
            this.starfield.tilePositionY = Math.floor(this.cameras.main.scrollY * 0.2)
        }

        this.updateOtherPlayersRendering()

        if (this.isDead) {
            this.updateSpectatorCamera()
            return
        }

        if (!this.playerContainer || !this.cursors) return
        
        let vx = 0
        let vy = 0

        vx = (this.cursors.right.isDown ? 1 : 0) - (this.cursors.left.isDown ? 1 : 0)
        vy = (this.cursors.down.isDown ? 1 : 0) - (this.cursors.up.isDown ? 1 : 0)

        if (this.joystickPointer && this.joystickPointer.isDown) {
            const base = this.joystickBase!
            const dist = Phaser.Math.Distance.Between(this.joystickPointer.x, this.joystickPointer.y, base.x, base.y)
            const angle = Phaser.Math.Angle.Between(base.x, base.y, this.joystickPointer.x, this.joystickPointer.y)

            const maxDist = 60
            const clampedDist = Math.min(dist, maxDist)

            this.joystickThumb?.setPosition(
                base.x + Math.cos(angle) * clampedDist,
                base.y + Math.sin(angle) * clampedDist
            )

            vx = Math.cos(angle) * (clampedDist / maxDist)
            vy = Math.sin(angle) * (clampedDist / maxDist)
        }

        const inputLength = Math.sqrt(vx * vx + vy * vy)

        if (inputLength > 1) {
            vx /= inputLength
            vy /= inputLength
        }

        let movementAngle = this.playerContainer.ship.angle

        if (vx !== 0 || vy !== 0) {
            movementAngle = (Math.atan2(vy, vx) * (180 / Math.PI)) + ANGLE_OFFSET
            this.playerContainer.ship.angle = (Math.atan2(vy, vx) * (180 / Math.PI)) + ANGLE_OFFSET
        }

        const currentInputs = {
            up: vy < -0.1 || this.cursors.up.isDown,
            down: vy > 0.1 || this.cursors.down.isDown,
            left: vx < -0.1 || this.cursors.left.isDown,
            right: vx > 0.1 || this.cursors.right.isDown,
            vx,
            vy,
            angle: movementAngle,
            shoot: false
        } as iPlayerInputs

        const moveStepX = vx * PLAYER_SPEED * dt
        const moveStepY = vy * PLAYER_SPEED * dt

        let nextX = this.playerContainer.x + moveStepX
        let nextY = this.playerContainer.y + moveStepY

        nextX = Phaser.Math.Clamp(nextX, PLAYER_RADIUS, WORLD_WIDTH - PLAYER_RADIUS)
        nextY = Phaser.Math.Clamp(nextY, PLAYER_RADIUS, WORLD_HEIGHT - PLAYER_RADIUS)
        
        if (!this.checkCollision(nextX, nextY)) {
            this.playerContainer.x = nextX
            this.playerContainer.y = nextY
        }

        this.socket.emit(GAME_EVENTS.INPUT_UPDATE, currentInputs)

        const isMoving = vx !== 0 || vy !== 0

        if (isMoving) {
            this.playerContainer.updateEmitter()
            if (!this.playerContainer.emitter.emitting) this.playerContainer.emitter.start()
        }
        else {
            this.playerContainer.emitter.stop()
        }

        this.playerContainer.redrawHealthBar()

        this.bullets.getChildren().forEach(bulletObj => {
            const bullet = bulletObj as iBulletSprite

            const isColliding = this.checkCollision(bullet.x, bullet.y)

            if (isColliding) {
                bullet.destroy()
            }
        })
    }

    shoot(pointer: Phaser.Input.Pointer) {
        if (
            !this.playerContainer
            || !this.socket.id
            || pointer === this.joystickPointer
            || this.isDead
        ) {
            return
        }

        const container = this.playerContainer

        const angleInRadians = Phaser.Math.Angle.Between(
            container.x,
            container.y,
            pointer.x + this.cameras.main.scrollX,
            pointer.y + this.cameras.main.scrollY
        )

        const vx = Math.cos(angleInRadians) * BULLET_SPEED
        const vy = Math.sin(angleInRadians) * BULLET_SPEED

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
        bullet.setDepth(10)

        if (this.isMobile) {
            bullet.setScale(1.5)
        }

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

        if (this.uiCamera) this.uiCamera.ignore(bullet)
        if (this.backgroundCamera) this.backgroundCamera.ignore(bullet)
    }

    private setupGroups = () => {
        if (this.otherPlayers) {
            this.otherPlayers.clear(true, true)
        }

        this.otherPlayers = this.add.group()
        this.bullets = this.physics.add.group()
        this.heals = this.physics.add.group()
        this.obstaclesGroup = this.add.group()
        this.uiGroup = this.add.group()
    }

    private setupPhysics = () => {
        this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
        
        this.physics.add.overlap(this.bullets, [], (_, bulletObj) => {
            const bullet = bulletObj as iBulletSprite
            this.createBulletImpact(bullet.x, bullet.y)
            bullet.destroy()
        })
    }

    private setupBackground = () => {
        const { width, height } = this.scale

        this.starfield = this.add.tileSprite(0, 0, width, height, 'stars')
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(-1)

        this.cameras.main.ignore(this.starfield)
        if (this.uiCamera) this.uiCamera.ignore(this.starfield)
        if (this.minimap) this.minimap.ignore(this.starfield)
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
            this.uiGroup.add(this.minimapBorder)
        }

        this.updateMinimapLayout(mapSize, margin)

        if (this.starfield) this.minimap.ignore(this.starfield)
    }

    private updateMinimapLayout = (mapSize: number, margin: number) => {
        const x = this.scale.width - mapSize - margin
        const y = margin

        if (this.minimap) {
            this.minimap.setPosition(x, y)
            this.minimap.setSize(mapSize, mapSize)

            const zoom = mapSize / GAME_SETTINGS.WORLD_WIDTH
            this.minimap.setZoom(zoom)
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
        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (this.joystickBase) {
                const distToJoystick = Phaser.Math.Distance.Between(
                    pointer.x, pointer.y, this.joystickBase.x, this.joystickBase.y
                )

                if (distToJoystick < this.JOYSTICK_RADIUS) {
                    return
                }
            }

            this.shoot(pointer)
        })
    }

    private setupLeaderboard = () => {
        const style = {
            fontFamily: 'Arial, sans-serif', 
            fontSize: this.isMobile ? '14px' : '18px', 
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3
        }

        const bg = this.add.graphics().setScrollFactor(0).setDepth(999)
        bg.fillStyle(0x000000, 0.5)
        bg.fillRoundedRect(
            10,
            10,
            this.isMobile ? 180 : 270,
            this.isMobile ? 180 : 220,
            10
        )

        this.uiGroup.add(bg)

        this.waveTextDisplay = this.add.text(
            20, 20, '',
            { ...style, color: '#ff0000', fontSize: this.isMobile ? '16px' : '20px' }
        ).setScrollFactor(0).setDepth(1000)

        this.uiGroup.add(this.waveTextDisplay)

        const tableTop = 50

        this.rankColumn = this.add.text(20, tableTop, '', style)
            .setScrollFactor(0).setDepth(1000)

        this.uiGroup.add(this.rankColumn)

        this.nameColumn = this.add.text(this.isMobile ? 50 : 60, tableTop, '', style)
            .setScrollFactor(0).setDepth(1000)

        this.uiGroup.add(this.nameColumn)

        this.scoreColumn = this.add.text(20 + (this.isMobile ? 160 : 250), tableTop, '', { ...style, align: 'right' })
            .setOrigin(1, 0).setScrollFactor(0).setDepth(1000)

        this.uiGroup.add(this.scoreColumn)

        if (this.minimap) {
            this.minimap.ignore([this.rankColumn, this.nameColumn, this.scoreColumn, bg, this.waveTextDisplay])
        }
    }

    private setupCameras = () => {
        this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height)
        this.uiCamera.setScroll(0, 0)

        if (this.starfield) this.uiCamera.ignore(this.starfield)

        this.cameras.main.ignore(this.uiGroup)

        if (this.minimap) this.minimap.ignore(this.uiGroup)

        this.uiCamera.ignore(this.otherPlayers)
        this.uiCamera.ignore(this.bullets)
        this.uiCamera.ignore(this.heals)
        this.uiCamera.ignore(this.obstaclesGroup)

        this.backgroundCamera.ignore(this.otherPlayers)
        this.backgroundCamera.ignore(this.bullets)
        this.backgroundCamera.ignore(this.heals)
        this.backgroundCamera.ignore(this.obstaclesGroup)
        this.backgroundCamera.ignore(this.uiGroup)

        if (this.playerContainer) this.backgroundCamera.ignore(this.playerContainer)

        const mainCamera = this.cameras.main

        this.cameras.remove(this.backgroundCamera, false)
        this.cameras.addExisting(this.backgroundCamera)

        this.cameras.remove(mainCamera, false)
        this.cameras.addExisting(mainCamera)

        if (this.minimap) {
            this.cameras.remove(this.minimap, false)
            this.cameras.addExisting(this.minimap)
        }

        this.cameras.remove(this.uiCamera, false)
        this.cameras.addExisting(this.uiCamera)

        this.cameras.main = mainCamera
        this.cameras.main.transparent = true
    }
    
    private setupObstacles(obstacles: ObstaclesType) {
        obstacles.forEach(obs => {
            if (obs.type === 'circle') {
                const { worldX, worldY, radius } = obs as iCircleObstacle

                const asteroid = this.add.sprite(worldX, worldY, 'planet')
                asteroid.setDisplaySize(radius * 2.4, radius * 2.4)
                asteroid.setDepth(10)
                this.obstaclesGroup.add(asteroid)

                if (this.uiCamera) this.uiCamera.ignore(asteroid)
                if (this.backgroundCamera) this.backgroundCamera.ignore(asteroid)
            }
            else if (obs.type === 'rect') {
                const { worldX, worldY, width, height } = obs as iRectObstacle

                const wall = this.add.image(worldX, worldY, 'ship_wall')
                wall.setOrigin(0, 0)
                wall.setDisplaySize(width, height)
                wall.setDepth(10)
                this.obstaclesGroup.add(wall)

                if (this.uiCamera) this.uiCamera.ignore(wall)
                if (this.backgroundCamera) this.backgroundCamera.ignore(wall)
            }
            else if (obs.type === 'compound_rect') {
                const { worldX, worldY } = obs as iCompoundRectObstacle

                const shipImg = this.add.image(worldX, worldY, 'ship_wall')
                shipImg.setOrigin(0, 0)
                shipImg.setDisplaySize(150, 335) 
                shipImg.setDepth(10)
                this.obstaclesGroup.add(shipImg)

                if (this.uiCamera) this.uiCamera.ignore(shipImg)
                if (this.backgroundCamera) this.backgroundCamera.ignore(shipImg)
            }
        })
    }

    private setupMobileControls() {
        if (this.joystickBase || this.joystickThumb) {
            this.joystickBase?.destroy()
            this.joystickThumb?.destroy()
        }

        const x = 100
        const y = this.scale.height - 100

        this.joystickBase = this.add.circle(x, y, 60, 0x888888, 0.4)
            .setScrollFactor(0).setDepth(10000)

        this.uiGroup.add(this.joystickBase)

        this.joystickThumb = this.add.circle(x, y, 30, 0xcccccc, 0.8)
            .setScrollFactor(0).setDepth(10001)

        this.uiGroup.add(this.joystickThumb)

        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (!this.joystickBase) return

            const dist = Phaser.Math.Distance.Between(pointer.x, pointer.y, this.joystickBase.x, this.joystickBase.y)

            if (dist < this.JOYSTICK_RADIUS) {
                this.joystickPointer = pointer
            }
        })

        this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
            if (this.joystickPointer === pointer && this.joystickBase && this.joystickThumb) {
                this.joystickPointer = undefined
                this.joystickVector.set(0, 0)
                this.joystickThumb.setPosition(this.joystickBase.x, this.joystickBase.y)
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
        explosion.setDepth(10)

        explosion.explode(40)

        this.time.delayedCall(600, () => {
            explosion.destroy()
        })

        if (this.uiCamera) this.uiCamera.ignore(explosion)
        if (this.backgroundCamera) this.backgroundCamera.ignore(explosion)
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
        sparks.setDepth(10)

        sparks.explode(10)

        this.time.delayedCall(200, () => {
            sparks.destroy()
        })

        if (this.uiCamera) this.uiCamera.ignore(sparks)
        if (this.backgroundCamera) this.backgroundCamera.ignore(sparks)
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
                }
                else {
                    this.addOtherPlayer(players[id])
                }
            })
        })

        this.socket.on(GAME_EVENTS.PLAYER_JOINED, (playerInfo: iPlayer) => {
            this.addOtherPlayer(playerInfo)
        })

        this.socket.on(GAME_EVENTS.SERVER_UPDATE, (data: iServerUpdateData) => {
            if (data.wave) this.isSurvival = true

            const serverIds = new Set(Object.keys(data.players))

            this.otherPlayers.getChildren().forEach(obj => {
                const otherPlayer = obj as SpaceShip

                if (!serverIds.has(otherPlayer.playerId)) {
                    otherPlayer.destroy()
                }
            })

            serverIds.forEach(id => {
                const serverPlayerData = data.players[id]

                if (id === this.socket.id && this.playerContainer) {
                    const dist = Phaser.Math.Distance.Between(
                        this.playerContainer.x,
                        this.playerContainer.y,
                        serverPlayerData.x,
                        serverPlayerData.y
                    )
                    if (dist < 100) {
                        this.playerContainer.x = Phaser.Math.Linear(this.playerContainer.x, serverPlayerData.x, 0.1)
                        this.playerContainer.y = Phaser.Math.Linear(this.playerContainer.y, serverPlayerData.y, 0.1)
                    }
                    else {
                        this.playerContainer.x = serverPlayerData.x
                        this.playerContainer.y = serverPlayerData.y
                    }

                    this.playerContainer.hp = serverPlayerData.hp
                    this.playerContainer.redrawHealthBar()
                } 
                else if (id !== this.socket.id) {
                    let otherPlayer: SpaceShip | undefined
                    this.otherPlayers.getChildren().forEach(obj => {
                        const p = obj as SpaceShip
                        if (p.playerId === id) otherPlayer = p
                    })

                    if (!otherPlayer) {
                        this.addOtherPlayer(serverPlayerData)
                        return
                    }

                    otherPlayer.targetX = serverPlayerData.x
                    otherPlayer.targetY = serverPlayerData.y
                    otherPlayer.targetRotation = serverPlayerData.angle
                    otherPlayer.hp = serverPlayerData.hp
                }
            })

            data.heals.forEach(healData => {
                const healSprites = this.heals.getChildren() as Phaser.GameObjects.Sprite[]
                let healSprite = healSprites.find(h => h.getData('healId') === healData.id)

                if (!healSprite) {
                    healSprite = this.heals.create(healData.x, healData.y, 'heal_icon') as Phaser.GameObjects.Sprite
                    healSprite.setData('healId', healData.id)
                    healSprite.setScale(this.isMobile ? 1.2 : 0.8)
                    healSprite.setTint(0x00ff00)
                    healSprite.setDepth(10)
                }

                healSprite.setPosition(healData.x, healData.y)
                healSprite.setActive(healData.active)
                healSprite.setVisible(healData.active)

                if (this.uiCamera) this.uiCamera.ignore(healSprite)
                if (this.backgroundCamera) this.backgroundCamera.ignore(healSprite)
            })
        })

        this.socket.on(GAME_EVENTS.INITIAL_OBSTACLES, (obstacles: ObstaclesType) => {
            this.obstacles = obstacles
            this.setupObstacles(obstacles)
        })

        this.socket.on(GAME_EVENTS.PLAYER_HIT, (data: { playerId: string, hp: number, bulletId: string }) => {
            this.handlePlayerHit(data)
        })

        this.socket.on(GAME_EVENTS.LEADERBOARD_UPDATE, (data: iLeaderboardUpdate[]) => {
            this.waveTextDisplay?.setText('Top 5 Global players:')

            this.setLeaderboardText(data)
        })

        this.socket.on(GAME_EVENTS.SURVIVAL_LEADERBOARD_UPDATE, (update: iSurvivalLeaderboardUpdate) => {
            const { data, wave } = update

            this.waveTextDisplay?.setText(`WAVE: ${wave}`)
            this.setLeaderboardText(data)
        })

        this.socket.on(GAME_EVENTS.PLAYER_LEFT, (playerId: string) => {
            const playerToRemove = this.otherPlayers.getChildren().find(
                obj => (obj as SpaceShip).playerId === playerId
            ) as SpaceShip

            if (playerToRemove) {
                playerToRemove.destroy()
            }
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

        this.socket.on(GAME_EVENTS.PLAYER_DIED, (data: { playerId: string, respawnIn: number }) => {
            if (!this.isSurvival) return

            let targetShip: SpaceShip | null = null

            if (data.playerId === this.socket.id) {
                targetShip = this.playerContainer
                this.handleLocalDeath()
            }
            else {
                this.otherPlayers.getChildren().forEach(obj => {
                    const ship = obj as SpaceShip
                    if (ship.playerId === data.playerId) targetShip = ship
                })
            }

            if (targetShip) {
                this.createExplosion(targetShip.x, targetShip.y)
                targetShip.setVisible(false)
                if (targetShip.emitter) targetShip.emitter.stop()
            }
        })

        this.socket.on(GAME_EVENTS.PLAYER_RESPAWN, (data: { playerId: string, x: number, y: number, hp: number }) => {
            let targetShip: SpaceShip | null = null

            if (data.playerId === this.socket.id) {
                targetShip = this.playerContainer
                this.isDead = false
                this.respawnTimerText?.setVisible(false)
                this.cleanSpectatorUI()
            } else {
                this.otherPlayers.getChildren().forEach(obj => {
                    const ship = obj as SpaceShip
                    if (ship.playerId === data.playerId) targetShip = ship
                })
            }

            if (targetShip) {
                targetShip.setPosition(data.x, data.y)
                targetShip.hp = data.hp
                targetShip.setAlpha(1)
                targetShip.setVisible(true)
                targetShip.redrawHealthBar()
            }
        })

        this.socket.on(GAME_EVENTS.WAVE_STARTED, (data: { wave: number, botCount: number }) => {
            this.waveTextDisplay?.setText(`WAVE: ${data.wave}`)
            this.showWaveMessage(data.wave)
        })

        this.socket.on(GAME_EVENTS.GAME_OVER, (data: { username: string, survival_high_score: number }[]) => {
            this.isDead = false
            this.isSurvival = false

            this.hideDeathScreen()
            this.cleanSpectatorUI()

            const errorPage = document.getElementById('error-screen')!
            const messageTitle = document.getElementById('error-title')!
            const messageDescription = document.getElementById('error-description')!
            const listFirstRow = document.getElementById('survival-list-first-row')!
            const list = document.getElementById('survival-list')!

            listFirstRow.style.display = 'flex'
            errorPage.style.display = 'flex'

            messageTitle.innerText = '💀 Game Over'
            messageDescription.innerText = '🌍 Top 5 Global Survival players:'
            messageDescription.style = 'font-size: 20px'

            list.innerHTML = data.map(p => `
                <div class='player-row'>
                    <span>${p.username}</span>
                    <div style="margin-right: 30px">${p.survival_high_score}</div>
                </div>
            `).join('')
        })
    }

    private handlePlayerHit = (data: { playerId: string, hp: number, bulletId: string }) => {
        let targetPlayer: SpaceShip | null = null
        let isFriendlyColor = false

        if (data.playerId === this.socket.id) {
            targetPlayer = this.playerContainer
        }
        else {
            this.otherPlayers.getChildren().forEach(obj => {
                const otherPlayer = obj as SpaceShip
                if (otherPlayer.playerId === data.playerId) targetPlayer = otherPlayer
            })
        }

        if (targetPlayer) {
            if (this.isSurvival && !targetPlayer.playerId.includes('Bot')) isFriendlyColor = true

            targetPlayer.hp = data.hp
            targetPlayer.redrawHealthBar()
            
            targetPlayer.ship.setTint(0xffffff) 

            this.time.delayedCall(100, () => {
                if (!targetPlayer) return
                targetPlayer.playerId === this.socket.id
                    ? targetPlayer.ship.clearTint()
                    : isFriendlyColor ? targetPlayer.ship.setTint(0x00aaff) : targetPlayer.ship.setTint(0xff0000)
            })

            this.createBulletImpact(targetPlayer.x, targetPlayer.y)
        }

        this.handleBulletHit(data.bulletId)
    }

    private handleLocalDeath() {
        this.isDead = true
        this.spectatorIndex = 0

        if (this.playerContainer) {
            this.playerContainer.setAlpha(0.5)
        }
        const centerY = this.scale.height / 2

        this.specLeftBtn = this.add.text(50, centerY, '◀', { fontSize: '48px', color: '#ffffff', backgroundColor: '#00000088', padding: {x:10, y:10} })
            .setInteractive({ useHandCursor: true })
            .setScrollFactor(0).setDepth(20002)
            .on('pointerdown', () => this.changeSpectatorTarget(-1))

        this.uiGroup.add(this.specLeftBtn)

        this.specRightBtn = this.add.text(this.scale.width - 100, centerY, '▶', { fontSize: '48px', color: '#ffffff', backgroundColor: '#00000088', padding: {x:10, y:10} })
            .setInteractive({ useHandCursor: true })
            .setScrollFactor(0).setDepth(20002)
            .on('pointerdown', () => this.changeSpectatorTarget(1))

        this.uiGroup.add(this.specRightBtn)

        this.spectatorNameText = this.add.text(this.scale.width / 2, centerY + 150, '', { fontSize: '24px', color: '#00ff00' })
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(20002)

        this.uiGroup.add(this.spectatorNameText)

        this.updateSpectatorUI()
    }

    private hideDeathScreen() {
        this.deathOverlay?.setVisible(false)
        this.deathText?.setVisible(false)
        this.respawnTimerText?.setVisible(false)
    }

    private changeSpectatorTarget(dir: number) {
        const alivePlayers = this.getAlivePlayers()
        if (alivePlayers.length === 0) return
        
        this.spectatorIndex = (this.spectatorIndex + dir + alivePlayers.length) % alivePlayers.length
        this.updateSpectatorUI()
    }

    private updateSpectatorUI() {
        const alivePlayers = this.getAlivePlayers()

        if (alivePlayers.length > 0) {
            const target = alivePlayers[this.spectatorIndex % alivePlayers.length]
            this.spectatorNameText?.setText(`SPECTATING: ${target.nameTag.text}`)
        }
        else {
            this.spectatorNameText?.setText(`WAITING FOR RESPAWN...`)
        }
    }

    private getAlivePlayers(): SpaceShip[] {
        return this.otherPlayers.getChildren().filter(obj => (obj as SpaceShip).visible) as SpaceShip[]
    }

    private updateSpectatorCamera() {
        const alivePlayers = this.getAlivePlayers()

        if (alivePlayers.length > 0) {
            const index = Math.abs(this.spectatorIndex) % alivePlayers.length
            const target = alivePlayers[index]

            if (target) {
                const targetX = target.x - this.cameras.main.width / 2
                const targetY = target.y - this.cameras.main.height / 2

                this.cameras.main.scrollX = Phaser.Math.Linear(this.cameras.main.scrollX, targetX, 0.1)
                this.cameras.main.scrollY = Phaser.Math.Linear(this.cameras.main.scrollY, targetY, 0.1)
            }
        }
    }

    private showWaveMessage(wave: number) {
        const text = `WAVE ${wave}\nSTARTED!`

        const waveText = this.add.text(this.scale.width / 2, this.scale.height / 2, text, {
            fontSize: '80px',
            color: '#ff0000',
            fontStyle: 'bold',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 8
        }).setOrigin(0.5).setScrollFactor(0).setDepth(30000).setAlpha(0)

        this.uiGroup.add(waveText)

        this.cameras.main.ignore(waveText)
        if (this.minimap) this.minimap.ignore(waveText)
        if (this.backgroundCamera) this.backgroundCamera.ignore(waveText)

        this.tweens.add({
            targets: waveText,
            alpha: 1,
            scale: { from: 0.5, to: 1 },
            duration: 500,
            ease: 'Back.easeOut',
            onComplete: () => {
                this.time.delayedCall(2000, () => {
                    this.tweens.add({
                        targets: waveText,
                        alpha: 0,
                        y: waveText.y - 100,
                        duration: 500,
                        onComplete: () => waveText.destroy()
                    })
                })
            }
        })
    }

    private updateOtherPlayersRendering() {
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
                }
                else {
                    otherPlayer.emitter.stop()
                }
            }

            otherPlayer.redrawHealthBar()
        })
    }

    private cleanSpectatorUI() {
        this.specLeftBtn?.destroy()
        this.specRightBtn?.destroy()
        this.spectatorNameText?.destroy()
        this.specLeftBtn = undefined
        this.specRightBtn = undefined
        this.spectatorNameText = undefined
    }

    private setLeaderboardText(data: iLeaderboardUpdate[]) {
        let ranks = '🏆\n\n'
        let names = 'PILOT\n\n'
        let scores = 'SCORE\n\n'

        data.forEach((player, index) => {
            const name = player.username || 'Unknown'
            const score = player.high_score || 0

            const formattedName = name.length >= 15
                ? `${name.substring(0, 15)}...`
                : name

            ranks += `${index + 1}.\n`
            names += `\u200E${formattedName}\n`
            scores += `${score.toLocaleString()}\n`
        })

        this.rankColumn.setText(ranks)
        this.nameColumn.setText(names)
        this.scoreColumn.setText(scores)
    }
}