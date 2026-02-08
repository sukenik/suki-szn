import { io, Socket } from 'socket.io-client'
import { GAME_ERRORS, GAME_EVENTS, GAME_MODE, type GameModeType } from '../../../../shared/consts'
import { phaserConfig, appConfig } from '../../config'
import { SurvivalLobby } from '../lobby/SurvivalLobby'

const { serverUrl, clientUrl } = appConfig

const launchPhaser = (socket: Socket, loginScreen: HTMLElement | null) => {
	let gameInstance: Phaser.Game | undefined

	if (!gameInstance) { // TODO: necessary?
		gameInstance = new Phaser.Game(phaserConfig)
		gameInstance.registry.set('socket', socket)
		loginScreen?.remove()
	}
}

export const startGame = async (
	user: any,
	mode: GameModeType,
	loginScreen: HTMLElement | null,
	existingRoom: string | null
) => {
	const token = await user.getIdToken()

	const socket = io(serverUrl, {
		auth: {
			token,
			mode,
			roomId: existingRoom
		},
		transports: ['websocket'],
		reconnectionAttempts: 10,
		timeout: 20000
	})

	socket.on('connect', () => {
		const buttons = document.getElementsByClassName('back-to-menu-btn')!

		for (let i = 0; i < buttons.length; i++) {
			const button = buttons.item(i)!

			button.addEventListener('click', () => {
				window.location.href = clientUrl
			})
		}

		socket.on('error', (message) => {
			const errorPage = document.getElementById('error-screen')!
			const messageTitle = document.getElementById('error-title')!
			errorPage.style.display = 'flex'

			if (message === GAME_ERRORS.ROOM_NOT_FOUND) {
				messageTitle.innerText = '🏘️ Room not found'
			}
			else if (message === GAME_ERRORS.GAME_IN_PROGRESS) {
				messageTitle.innerText = '🎮 Game in progress'
			}
		})

		if (mode === GAME_MODE.MULTIPLAYER) {
			launchPhaser(socket, loginScreen)
		}
		else {
			const lobby = new SurvivalLobby(socket)

			existingRoom
				? socket.emit(GAME_EVENTS.JOIN_SURVIVAL, existingRoom)
				: socket.emit(GAME_EVENTS.CREATE_SURVIVAL)

			socket.on(GAME_EVENTS.ROOM_CREATED, (data: { roomId: string }) => {
				lobby.show(data.roomId)
			})

			socket.on(GAME_EVENTS.ROOM_JOINED, (data: { roomId: string }) => {
				lobby.show(data.roomId)
			})

			socket.on(GAME_EVENTS.GAME_START, () => {
				lobby.hide()
				launchPhaser(socket, loginScreen)
			})
		}
	})
}