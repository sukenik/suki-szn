import type { FirebaseError } from 'firebase/app'
import { onAuthStateChanged } from 'firebase/auth'
import { io } from 'socket.io-client'
import { auth, loginEmail, loginWithGoogle, registerEmail } from './firebase'
import { getError } from './logic'
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
        // TODO: test
        autoRound: true,
        fullscreenTarget: 'game-container'
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
    let gameInstance: Phaser.Game | undefined
    let isRegistering = false
    let isAuthenticated = false
    let isServerUp = false

    const serverUrl = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000'

    const loginScreen = document.getElementById('ui-layer')
    const loginBtn = document.getElementById('login-button') as HTMLButtonElement
    const emailRegBtn = document.getElementById('email-reg-btn') as HTMLButtonElement
    const emailLoginBtn = document.getElementById('email-login-btn') as HTMLButtonElement
    const usernameInput = document.getElementById('username-input') as HTMLInputElement
    const emailInput = document.getElementById('email-input') as HTMLInputElement
    const passInput = document.getElementById('pass-input') as HTMLInputElement
    const toggleBtn = document.getElementById('toggle-password')
    const statusDiv = document.getElementById('server-status')
    const statusText = document.getElementById('status-text')
    const spinner = document.getElementById('spinner')
    const errorDiv = document.getElementById('error')
    const errorText = document.getElementById('error-text')

    if (loginScreen) loginScreen.style.display = 'flex'

    const showStatus = (msg: string) => {
        if (statusDiv && statusText) {
            statusDiv.style.display = 'flex'
            statusText.textContent = msg
        }
    }

    const showError = (msg: string) => {
        if (errorDiv && errorText) {
            errorDiv.style.display = 'flex'
            errorText.style.color = '#ff4444'
            errorText.textContent = msg
        }
    }

    !isServerUp && showStatus('📡 Contacting command center...')

    const fetchInterval = setInterval(() => {
        fetch(`${serverUrl}/health`, { mode: 'no-cors' })
            .then(() => {
                isServerUp = true

                if (isAuthenticated) {
                    showStatus(`🔥 Server is up - let's go!`)
                }
                else {
                    if (statusDiv) statusDiv.style.display = 'none'
                }

                clearInterval(fetchInterval)
            })
            .catch(() => {
                if (!isAuthenticated) {
                    showStatus('Waking up server (may take up to 60s)...')
                }
                else {
                    // TODO: add disabled style
                    if (loginBtn) loginBtn.disabled = true
                    if (emailRegBtn) emailRegBtn.disabled = true
                    if (emailRegBtn) emailLoginBtn.disabled = true
                }
            })
    }, 1000)

    toggleBtn?.addEventListener('click', () => {
        const type = passInput.getAttribute('type') === 'password' ? 'text' : 'password'
        passInput.setAttribute('type', type)
        
        toggleBtn.textContent = type === 'password' ? '👁️' : '🙈'
    })

    emailRegBtn?.addEventListener('click', async () => {
        const email = emailInput.value
        const pass = passInput.value
        const user = usernameInput.value

        if (!email || !pass || !user) return showError('Please fill all fields')
        
        try {
            isRegistering = true
            const updatedUser = await registerEmail(email, pass, user)

            await handleUserConnected(updatedUser)

            isRegistering = false
        } catch (e: any) {
            const error = e as FirebaseError

            showError(getError(error.code))
        }
    })

    emailLoginBtn?.addEventListener('click', async () => {
        const email = emailInput.value
        const pass = passInput.value

        if (!email || !pass) return showError('Please fill both email & password')

        try {
            await loginEmail(email, pass)
        } catch (e: any) {
            const error = e as FirebaseError

            showError(getError(error.code))
        }
    })

    const handleUserConnected = async (user: any) => {
        isAuthenticated = true
        const token = await user.getIdToken()
        
        if (spinner) spinner.style.borderTopColor = '#00ff55'
        if (statusText) statusText.style.color = '#00ff55'
        if (errorDiv) errorDiv.style.display = 'none'

        !isServerUp && showStatus(`✅ You're authenticated - waiting for server...`)

        const socket = io(serverUrl, {
            auth: { token },
            transports: ['websocket'],
            reconnectionAttempts: 10,
            timeout: 20000
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
        }
        else {
            if (!loginScreen) return

            loginScreen.style.display = 'flex'

            if (loginBtn) {
                loginBtn.onclick = async () => {
                    try {
                        await loginWithGoogle()
                    } catch (error) {
                        showError(`Login failed: ${error}`)
                    }
                }
            }
        }
    })
}

startApp()