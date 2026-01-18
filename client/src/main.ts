import Phaser from 'phaser'
import { io, Socket } from 'socket.io-client'
import { GAME_HEIGHT, GAME_WIDTH, PLAYER_HP, PLAYER_SIZE_IN_PX, SERVER_URL } from '../../shared/consts'
import type { iBullet, iPlayer } from '../../shared/types'
import { GameEvents } from '../../shared/types'

class MainScene extends Phaser.Scene {
    private socket!: Socket
    private player!: Phaser.Physics.Arcade.Sprite
    private otherPlayers!: Phaser.GameObjects.Group
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
    private bullets!: Phaser.Physics.Arcade.Group
    private leaderboardText!: Phaser.GameObjects.Text
    private playerEmitter!: Phaser.GameObjects.Particles.ParticleEmitter

    constructor() {
        super('MainScene')
    }

    preload() {
        this.load.image('ship', 'https://labs.phaser.io/assets/sprites/fmship.png')
        this.load.image('bullet', 'https://labs.phaser.io/assets/sprites/bullets/bullet7.png')
    }

    create() {
        this.socket = io(SERVER_URL)
        this.otherPlayers = this.add.group()
        this.bullets = this.physics.add.group()
        this.leaderboardText = this.add.text(10, 10, 'Loading Leaderboard...', {
            fontSize: '18px',
            color: '#ffffff',
            backgroundColor: 'rgba(0,0,0,0.5)',
            padding: { x: 10, y: 5 }
        }).setScrollFactor(0).setDepth(100)
        this.playerEmitter = this.add.particles(0, 0, 'bullet', {
            speed: 100,
            scale: { start: 0.5, end: 0 },
            alpha: { start: 1, end: 0 },
            blendMode: 'ADD',
            lifespan: 300,
            tint: 0xffaa00,
            emitting: false
        }).setDepth(1)

        if (this.input.keyboard) {
            this.cursors = this.input.keyboard.createCursorKeys()
        }

        this.socket.on(GameEvents.CURRENT_PLAYERS, (players: { [id: string]: iPlayer }) => {
            Object.keys(players).forEach((id) => {
                if (id === this.socket.id) {
                    this.addMainPlayer(players[id])
                } else {
                    this.addOtherPlayer(players[id])
                }
            })
        })

        this.socket.on(GameEvents.PLAYER_JOINED, (playerInfo: iPlayer) => {
            this.addOtherPlayer(playerInfo)
        })

        this.socket.on(GameEvents.PLAYER_MOVED, (playerInfo: iPlayer) => {
            this.otherPlayers.getChildren().forEach((otherPlayer: any) => {
                if (playerInfo.id === otherPlayer.playerId) {
                    otherPlayer.targetX = playerInfo.x
                    otherPlayer.targetY = playerInfo.y
                    otherPlayer.targetRotation = playerInfo.angle
                }
            })
        })

        this.socket.on(GameEvents.PLAYER_HIT, (data: { playerId: string, hp: number, bulletId: string }) => {
            if (data.playerId === this.socket.id && this.player) {
                (this.player as any).hp = data.hp
                this.player.setTint(0xff0000)
                this.time.delayedCall(100, () => this.player.clearTint())
            } else {
                this.otherPlayers.getChildren().forEach((otherPlayer: any) => {
                    if (otherPlayer.playerId === data.playerId) {
                        otherPlayer.hp = data.hp
                        otherPlayer.setTint(0xffffff)
                        this.time.delayedCall(100, () => otherPlayer.setTint(0xff0000))
                    }
                })
            }
        })

        this.socket.on(GameEvents.PLAYER_LEFT, (playerId: string) => {
            this.otherPlayers.getChildren().forEach((otherPlayer: any) => {
                if (playerId === otherPlayer.playerId) {
                    if (otherPlayer.emitter) {
                        otherPlayer.emitter.destroy()
                    }
                    otherPlayer.destroy()
                }
            })
        })

        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            this.shoot(pointer)
        })
        
        this.socket.on(GameEvents.NEW_BULLET, (bulletData: iBullet) => {
            this.createBullet(bulletData)
        })
        
        this.socket.on(GameEvents.PLAYER_DIED, (data: { playerId: string, newX: number, newY: number }) => {
            let deadPlayerX = 0
            let deadPlayerY = 0

            if (data.playerId === this.socket.id && this.player) {
                deadPlayerX = this.player.x
                deadPlayerY = this.player.y

                this.player.setPosition(data.newX, data.newY);
                (this.player as any).hp = PLAYER_HP
                
                this.cameras.main.flash(500, 255, 0, 0)
            } else {
                this.otherPlayers.getChildren().forEach((otherPlayer: any) => {
                    if (otherPlayer.playerId === data.playerId) {
                        deadPlayerX = otherPlayer.x
                        deadPlayerY = otherPlayer.y

                        otherPlayer.setPosition(data.newX, data.newY)
                        otherPlayer.targetX = data.newX
                        otherPlayer.targetY = data.newY
                        otherPlayer.hp = PLAYER_HP
                    }
                })
            }

            if (deadPlayerX !== 0 && deadPlayerY !== 0) {
                this.createExplosion(deadPlayerX, deadPlayerY)
            }
        })

        this.socket.on(GameEvents.LEADERBOARD_UPDATE, (data: { id: string, kills: number }[]) => {
            let text = 'Leaderboard:\n'
            const sorted = data.sort((a, b) => b.kills - a.kills)

            sorted.forEach(p => {
                const name = p.id === this.socket.id ? 'You' : p.id.substring(0, 4)
                text += `${name}: ${p.kills}\n`
            })
            this.leaderboardText.setText(text)
        })
    }

    addMainPlayer(playerInfo: iPlayer) {
        this.player = this.physics.add.sprite(playerInfo.x, playerInfo.y, 'ship') as any
        this.player.setDisplaySize(PLAYER_SIZE_IN_PX, PLAYER_SIZE_IN_PX)

        if (this.player.body instanceof Phaser.Physics.Arcade.Body) {
            this.player.body.setCollideWorldBounds(true)
        }
    }

    addOtherPlayer(playerInfo: iPlayer) {
        const otherPlayer = this.add.sprite(playerInfo.x, playerInfo.y, 'ship');
        (otherPlayer as any).playerId = playerInfo.id;
        (otherPlayer as any).hp = playerInfo.hp

        const emitter = this.add.particles(0, 0, 'bullet', {
            speed: 100,
            scale: { start: 0.4, end: 0 },
            alpha: { start: 1, end: 0 },
            blendMode: 'ADD',
            lifespan: 300,
            tint: 0xff4400,
            emitting: false
        }).setDepth(1);

        (otherPlayer as any).emitter = emitter

        otherPlayer.setTint(0xff0000)
        otherPlayer.setDisplaySize(PLAYER_SIZE_IN_PX, PLAYER_SIZE_IN_PX)

        if (otherPlayer.body instanceof Phaser.Physics.Arcade.Body) {
            otherPlayer.body.setCollideWorldBounds(true)
        }

        this.otherPlayers.add(otherPlayer)
    }

    update() {
        if (!this.player || !this.cursors || !this.playerEmitter) return

        const speed = 200
        const body = this.player.body as Phaser.Physics.Arcade.Body
        const prevPosition = { x: this.player.x, y: this.player.y, angle: this.player.angle }

        if (body.speed > 0) {
            const tailPoint = { x: this.player.x, y: this.player.y + 20 }

            Phaser.Math.RotateAround(
                tailPoint, 
                this.player.x, 
                this.player.y, 
                this.player.rotation
            )

            this.playerEmitter.setPosition(tailPoint.x, tailPoint.y)
            this.playerEmitter.setAngle(this.player.angle + 90)

            if (!this.playerEmitter.emitting) {
                this.playerEmitter.start()
            }
        } else {
            this.playerEmitter.stop()
        }

        body.setVelocity(0)

        if (this.cursors.left.isDown) body.setVelocityX(-speed)
        else if (this.cursors.right.isDown) body.setVelocityX(speed)

        if (this.cursors.up.isDown) body.setVelocityY(-speed)
        else if (this.cursors.down.isDown) body.setVelocityY(speed)

        if (body.velocity.x !== 0 || body.velocity.y !== 0) {
            const newAngle = Math.atan2(body.velocity.y, body.velocity.x)
            this.player.setRotation(newAngle + Math.PI / 2)
        }
        if (prevPosition.x !== this.player.x || prevPosition.y !== this.player.y || prevPosition.angle !== this.player.angle) {
            this.socket.emit(GameEvents.PLAYER_MOVEMENT, {
                x: this.player.x,
                y: this.player.y,
                angle: this.player.angle
            })
        }

        const mainHp = (this.player as any).hp ?? PLAYER_HP
        this.updateHealthBar(this.player, mainHp)

        this.otherPlayers.getChildren().forEach((otherPlayer: any) => {
            const currentHp = otherPlayer.hp ?? PLAYER_HP
            this.updateHealthBar(otherPlayer, currentHp)

            
            if (otherPlayer.targetX !== undefined && otherPlayer.targetY !== undefined) {
                otherPlayer.x = Phaser.Math.Linear(otherPlayer.x, otherPlayer.targetX, 0.2)
                otherPlayer.y = Phaser.Math.Linear(otherPlayer.y, otherPlayer.targetY, 0.2)

                const targetRad = Phaser.Math.DegToRad(otherPlayer.targetRotation)
                otherPlayer.rotation = Phaser.Math.Angle.RotateTo(otherPlayer.rotation, targetRad, 0.1)

                const emitter = otherPlayer.emitter
                if (emitter) {
                    const distanceMoved = Phaser.Math.Distance.Between(otherPlayer.x, otherPlayer.y, otherPlayer.targetX, otherPlayer.targetY)
                    
                    if (distanceMoved > 0.5) {
                        const tailPoint = { x: otherPlayer.x, y: otherPlayer.y + 20 }
                        Phaser.Math.RotateAround(tailPoint, otherPlayer.x, otherPlayer.y, otherPlayer.rotation)
                        
                        emitter.setPosition(tailPoint.x, tailPoint.y)
                        emitter.setAngle(otherPlayer.angle + 90)
                        
                        if (!emitter.emitting) emitter.start()
                    } else {
                        emitter.stop()
                    }
                }
            }
        })
    }
    
    shoot(pointer: Phaser.Input.Pointer) {
        if (!this.player) return

        const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, pointer.x, pointer.y)
        
        const bulletData: iBullet = {
            id: Math.random().toString(36).substring(7),
            playerId: this.socket.id!,
            x: this.player.x,
            y: this.player.y,
            angle: angle
        }

        this.socket.emit(GameEvents.PLAYER_SHOOT, bulletData)
        
        this.createBullet(bulletData)
    }

    createBullet(bulletData: iBullet) {
        const bullet = this.bullets.create(bulletData.x, bulletData.y, 'bullet')
        this.physics.velocityFromRotation(bulletData.angle, 400, bullet.body.velocity)

        bullet.setCollideWorldBounds(true)
        bullet.body.onWorldBounds = true

        bullet.body.world.on('worldbounds', (body: Phaser.Physics.Arcade.Body) => {
            if (body.gameObject === bullet) {
                bullet.destroy()
            }
        })
    }

    updateHealthBar(gameObject: any, hp: number) {
        if (!gameObject.healthBar) {
            gameObject.healthBar = this.add.graphics()
        }

        const bar = gameObject.healthBar
        bar.clear()

        bar.fillStyle(0xff0000)
        bar.fillRect(gameObject.x - 20, gameObject.y - 30, 40, 5)

        bar.fillStyle(0x00ff00)
        const healthWidth = Math.max(0, (hp / 100) * 40)
        bar.fillRect(gameObject.x - 20, gameObject.y - 30, healthWidth, 5)
    }

    private createExplosion(x: number, y: number) {
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
}

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#2d2d2d',
    physics: { default: 'arcade' },
    scene: MainScene
}

new Phaser.Game(config)