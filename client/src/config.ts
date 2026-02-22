import { MainScene } from './main'

export const phaserConfig: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    input: {
        activePointers: 3
    },
    scale: {
        mode: Phaser.Scale.RESIZE,
        parent: 'game-container',
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: '100%',
        height: '100%'
    },
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { x: 0, y: 0 },
            debug: false
        }
    },
    render: {
        pixelArt: false,
        antialias: true,
        roundPixels: false
    },
    fps: {
        target: 60,
        forceSetTimeOut: true
    },
    scene: MainScene
}

export const appConfig = {
    serverUrl: import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000',
    clientUrl: import.meta.env.VITE_CLIENT_URL ?? 'http://localhost:5173',
    USER_TOKEN: 'suki_token'
}