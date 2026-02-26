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