import { io, Socket } from 'socket.io-client'
import { GAME_ERRORS, GAME_EVENTS, GAME_MODE, type GameModeType } from '../../../../shared/consts'
import { appConfig, phaserConfig } from '../../config'
import { SurvivalLobby } from '../lobby/SurvivalLobby'

let gameInstance: Phaser.Game | undefined
let socket: Socket | undefined

const launchPhaser = (socket: Socket, loginScreen: HTMLElement | null) => {
	if (!gameInstance) {
		gameInstance = new Phaser.Game(phaserConfig)
		gameInstance.registry.set('socket', socket)
		loginScreen?.remove()
	}
}

export const getSocket = (token: string, existingRoom: string | null, mode?: GameModeType) => {
	if (socket && socket.connected) {
		socket.auth = { token, mode, roomId: existingRoom }
		return socket
	}

	if (socket) socket.removeAllListeners()

	return io(appConfig.serverUrl, {
		auth: {
			token,
			mode,
			roomId: existingRoom
		},
		transports: ['websocket'],
		autoConnect: false
	})
}

export const startGame = (
	token: string,
	mode: GameModeType,
	loginScreen: HTMLElement | null,
	existingRoom: string | null,
	clearLoadingPage: () => void
) => {
	if (gameInstance) return

	socket = getSocket(token, existingRoom, mode)

	socket.on('error', (message) => {
		clearLoadingPage()

		const errorPage = document.getElementById('error-screen')!
		const messageTitle = document.getElementById('error-title')!
		errorPage.style.display = 'flex'

		if (message === GAME_ERRORS.ROOM_NOT_FOUND) {
			messageTitle.innerText = '🏘️ Room not found'
		}
		else if (message === GAME_ERRORS.GAME_IN_PROGRESS) {
			messageTitle.innerText = '🎮 Game in progress'
		}
		else if (message === GAME_ERRORS.AUTH_FAILED) {
			messageTitle.innerText = '❌ Authentication failed'
		}
		else {
			messageTitle.innerText = '🤔 Something went wrong'
		}
	})

	socket.on(GAME_EVENTS.SERVER_READY, () => {
		if (!socket) return

		if (mode === GAME_MODE.MULTIPLAYER) {
			clearLoadingPage()
			launchPhaser(socket, loginScreen)
		}
		else {
			const lobby = new SurvivalLobby(socket)

			existingRoom
				? socket.emit(GAME_EVENTS.JOIN_SURVIVAL, existingRoom)
				: socket.emit(GAME_EVENTS.CREATE_SURVIVAL)

			socket.on(GAME_EVENTS.ROOM_CREATED, (data: { roomId: string }) => {
				const roomId = data.roomId

				const newUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`
				window.history.pushState({ path: newUrl }, '', newUrl)

				clearLoadingPage()
				lobby.show(roomId)
			})

			socket.on(GAME_EVENTS.ROOM_JOINED, (data: { roomId: string, isInProgress: boolean }) => {
				clearLoadingPage()
				data.isInProgress
					? launchPhaser(socket!, loginScreen)
					: lobby.show(data.roomId)
			})

			socket.on(GAME_EVENTS.GAME_START, () => {
				lobby.hide()
				launchPhaser(socket!, loginScreen)
			})
		}
	})

	socket.connect()
}

export const setBackToMenuBtns = (
	showLoadingPage: () => void,
	clearLoadingPage: () => void
) => {
	const buttons = document.getElementsByClassName('back-to-menu-btn')!

	for (let i = 0; i < buttons.length; i++) {
		const button = buttons.item(i)!

		button.addEventListener('click', () => {
			showLoadingPage()
			window.location.href = appConfig.clientUrl
			clearLoadingPage()
		})
	}
}

export const isIOSWebView = (): boolean => {
    const ua = window.navigator.userAgent.toLowerCase()
    const isIOS = /iphone|ipad|ipod/.test(ua)

    const isSafari = /safari/.test(ua)
    const isChrome = /crios/.test(ua)

    return isIOS && !isSafari && !isChrome
}

export const showWebViewWarning = () => {
    if (document.getElementById('webview-warning')) return

    const overlay = document.createElement('div')
    overlay.id = 'webview-warning'
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.9); z-index: 10000;
        display: flex; flex-direction: column; align-items: center;
        justify-content: center; color: white; text-align: center;
        padding: 20px; font-family: sans-serif;
    `;

    overlay.innerHTML = `
        <div style="font-size: 50px; margin-bottom: 20px;">⚠️</div>
        <h2 style="margin-bottom: 15px;">Google Login Restricted</h2>
        <p style="font-size: 18px; line-height: 1.5; margin-bottom: 25px;">
            LinkedIn's browser doesn't support Google Login.<br>
            Please tap the <b>three dots (⋮)</b> or <b>Share</b> icon and select 
            <br><span style="color: #3498db; font-weight: bold;">"Open in Safari"</span> to play.
        </p>
        <button id="close-warning" style="
            background: #444; color: white; border: none; 
            padding: 10px 20px; border-radius: 5px; cursor: pointer;
        ">Got it, thanks</button>
    `;

    document.body.appendChild(overlay)

    document.getElementById('close-warning')?.addEventListener('click', () => {
        overlay.remove()
    })
}