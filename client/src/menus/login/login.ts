import type { FirebaseError } from 'firebase/app'
import { onAuthStateChanged } from 'firebase/auth'
import { GAME_MODE } from '../../../../shared/consts'
import { appConfig } from '../../config'
import { auth, loginEmail, loginWithGoogle, registerEmail } from '../../firebase'
import { getError } from './logic'
import { setBackToMenuBtns, startGame, USER_TOKEN } from './utils'

const { serverUrl } = appConfig

async function startApp() {
    let isRegistering = false
    let isAuthenticated = false
    let isServerUp = false

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
    const modeSelector = document.getElementById('mode-selector')
    const multiplayerBtn = document.getElementById('multiplayer-btn')
    const survivalBtn = document.getElementById('survival-btn')
    let loadingScreen = document.getElementById('app-loading-screen')

    const showLoading = () => {
        if (!loadingScreen) {
            loadingScreen = document.createElement('div')
            loadingScreen.id = 'app-loading-screen'

            Object.assign(loadingScreen.style, {
                position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
                backgroundColor: '#000', display: 'flex', flexDirection: 'column',
                justifyContent: 'center', alignItems: 'center', zIndex: '9999',
                color: '#fff', fontFamily: 'monospace', fontSize: '1.5rem'
            })
            loadingScreen.innerHTML = `
                <div id="loading-text" style="margin-bottom: 20px;">Loading...</div>
                <div style="width: 40px; height: 40px; border: 4px solid #333; border-top: 4px solid #fff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
            `
            document.body.appendChild(loadingScreen)
        }
        loadingScreen.style.display = 'flex'
    }

    const hideLoading = () => {
        if (loadingScreen) loadingScreen.style.display = 'none'
    }

    setBackToMenuBtns(showLoading, hideLoading)

    const storedToken = localStorage.getItem(USER_TOKEN)
    const isTokenValid = (token: string) => {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]))
            return payload.exp > (Date.now() / 1000)
        } catch (e) {
            return false
        }
    }

    const hasValidToken = storedToken && isTokenValid(storedToken)

    if (loginScreen && !hasValidToken) loginScreen.style.display = 'flex'
    if (hasValidToken) {
        isAuthenticated = true
    }

    const showStatus = (msg: string) => {
        if (statusDiv && statusText) {
            statusDiv.style.display = 'flex'
            statusText.textContent = msg
        }
        const loadingText = document.getElementById('loading-text')
        if (loadingText) loadingText.textContent = msg
    }

    const showError = (msg: string) => {
        if (errorDiv && errorText) {
            errorDiv.style.display = 'flex'
            errorText.style.color = '#ff4444'
            errorText.textContent = msg
        }
    }

    !isServerUp && showStatus('📡 Waking up server (may take up to 60s)...')

    const fetchInterval = setInterval(() => {
        fetch(`${serverUrl}/health`, { mode: 'no-cors' })
            .then(() => {
                isServerUp = true

                if (isAuthenticated) {
                    const user = auth.currentUser || (hasValidToken ? { getIdToken: async () => storedToken } : null)
                    if (user) {
                        handleUserConnected(user)
                    }
                    showStatus(`🔥 Server is up - let's go!`)
                    showLoading()
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
                    showStatus(`✅ You're authenticated - waiting for server...`)
                    showLoading()
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

        if (user) {
            const token = await user.getIdToken()
            localStorage.setItem(USER_TOKEN, token)
        }

        if (spinner) spinner.style.borderTopColor = '#00ff55'
        if (statusText) statusText.style.color = '#00ff55'
        if (errorDiv) errorDiv.style.display = 'none'

        !isServerUp && showStatus(`✅ You're authenticated - waiting for server...`)

        if (isServerUp) {
            loginScreen?.remove()

            const urlParams = new URLSearchParams(window.location.search)
            const existingRoom = urlParams.get('room')

            if (existingRoom) {
                showStatus('Joining survival room...')
                showLoading()
                startGame(user, GAME_MODE.SURVIVAL, loginScreen, existingRoom, hideLoading)
            }
            else {
                if (modeSelector) {
                    hideLoading()
                    modeSelector.style.display = 'flex'

                    multiplayerBtn?.addEventListener('click', () => {
                        modeSelector.style.display = 'none'
                        showLoading()
                        startGame(user, GAME_MODE.MULTIPLAYER, loginScreen, existingRoom, hideLoading)
                    })

                    survivalBtn?.addEventListener('click', () => {
                        modeSelector.style.display = 'none'
                        showLoading()
                        startGame(user, GAME_MODE.SURVIVAL, loginScreen, existingRoom, hideLoading)
                    })
                }
            }
        }
    }

    onAuthStateChanged(auth, (user) => {
        if (user && !isRegistering) {
            handleUserConnected(user)
        }
        else {
            if (!loginScreen) return

            if (!isAuthenticated) {
                loginScreen.style.display = 'flex'
            }

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