import { onAuthStateChanged } from 'firebase/auth'
import { io } from 'socket.io-client'
import { auth, loginEmail, loginWithGoogle, registerEmail } from './firebase'
import { MainScene } from './main'

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    input: {
        activePointers: 3
    },
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        parent: 'game-container',
        width: '100%',
        height: '100%',
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

async function startApp() {
    let gameInstance: Phaser.Game | null = null

    const loginScreen = document.getElementById('ui-layer')
    const loginBtn = document.getElementById('login-button')
    const passInput = document.getElementById('pass-input') as HTMLInputElement
    const toggleBtn = document.getElementById('toggle-password')

    let isRegistering = false

    toggleBtn?.addEventListener('click', () => {
        const type = passInput.getAttribute('type') === 'password' ? 'text' : 'password'
        passInput.setAttribute('type', type)
        
        toggleBtn.textContent = type === 'password' ? '👁️' : '🙈'
    })

    document.getElementById('email-reg-btn')?.addEventListener('click', async () => {
        const email = (document.getElementById('email-input') as HTMLInputElement).value
        const pass = (document.getElementById('pass-input') as HTMLInputElement).value
        const user = (document.getElementById('username-input') as HTMLInputElement).value
        
        if (!email || !pass || !user) return alert('Please fill all fields')
        
        try {
            isRegistering = true
            const updatedUser = await registerEmail(email, pass, user)

            await handleUserConnected(updatedUser)

            isRegistering = false
        } catch (e: any) {
            isRegistering = false
            alert('Sign-up error: ' + e.message)
        }
    })

    document.getElementById('email-login-btn')?.addEventListener('click', async () => {
        const email = (document.getElementById('email-input') as HTMLInputElement).value
        const pass = (document.getElementById('pass-input') as HTMLInputElement).value

        if (!email || !pass) return alert('Please fill Email & Password')

        try {
            await loginEmail(email, pass)
        } catch (e: any) {
            alert('Login error: ' + e.message)
        }
    })

    const handleUserConnected = async (user: any) => {
        const token = await user.getIdToken()

        const serverUrl = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000'

        const socket = io(serverUrl, {
            auth: { token },
            transports: ['websocket']
        })

        socket.on('connect', () => {
            if (!gameInstance) {
                const game = new Phaser.Game(config)
                game.registry.set('socket', socket)
                loginScreen?.remove()
            }
        })
    }

    onAuthStateChanged(auth, (user) => {
        if (user && !isRegistering) {
            handleUserConnected(user)
        } else {
            if (!loginScreen) return

            loginScreen.style.display = 'flex'

            if (loginBtn) {
                loginBtn.onclick = async () => {
                    try {
                        await loginWithGoogle()
                    } catch (error) {
                        console.error('Login failed', error)
                    }
                }
            }
        }
    })
}

startApp()