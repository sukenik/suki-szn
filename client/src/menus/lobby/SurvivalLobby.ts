import type { Socket } from 'socket.io-client'
import { GAME_EVENTS } from '../../../../shared/consts'
import type { SurvivalRoomUpdateType } from '../../../../shared/types'

export class SurvivalLobby {
    private socket: Socket
    private lobbyElement: HTMLElement
    private timerDiv: HTMLElement
    private readyBtn: HTMLButtonElement
    private readyHelpText: HTMLButtonElement

    constructor(socket: Socket) {
        this.socket = socket
        this.lobbyElement = document.getElementById('survival-lobby')!
        this.timerDiv = document.getElementById('lobby-timer')!
        this.readyBtn = document.getElementById('ready-toggle-btn')! as HTMLButtonElement
        this.readyHelpText = document.getElementById('ready-help-text')! as HTMLButtonElement
    }

    public show(roomId: string) {
        this.lobbyElement.style.display = 'flex'

        this.setupInviteLink(roomId)
        this.setupListeners(roomId)
    }

    private setupInviteLink(roomId: string) {
        const linkInput = document.getElementById('room-link') as HTMLInputElement
        const copyLinkBtn = document.getElementById('copy-link-btn')!

        const fullLink = `${window.location.origin}?room=${roomId}`
        linkInput.value = fullLink

        document.getElementById('copy-link-btn')!.onclick = () => {
            navigator.clipboard.writeText(fullLink)
            
            copyLinkBtn.innerText = '✅ Copied!'
            setTimeout(() => copyLinkBtn.innerText = '📋 Copy', 2000)
        }
    }

    private setupListeners(roomId: string) {

        this.readyBtn.onclick = () => {
            this.socket.emit(GAME_EVENTS.TOGGLE_READY, roomId)
            const isReady = this.readyBtn.innerText === 'NOT READY'

            if (isReady) {
                this.readyBtn.classList.remove('not-ready')
                this.readyBtn.classList.add('ready')
                this.readyBtn.innerText = 'READY'
                this.readyHelpText.innerText = `If you're ready`
            }
            else {
                this.readyBtn.classList.remove('ready')
                this.readyBtn.classList.add('not-ready')
                this.readyBtn.innerText = 'NOT READY'
                this.readyHelpText.innerText = 'Not ready?'
            }

            this.readyHelpText.innerText += ' press the button ⬇️'
        }

        this.socket.on(GAME_EVENTS.ROOM_UPDATE, (data) => {
            this.renderPlayers(data.players as SurvivalRoomUpdateType)
        })

        this.socket.on(GAME_EVENTS.STARTING_COUNTDOWN, (seconds: number) => {
            const secondsSpan = document.getElementById('timer-seconds')

            if (this.timerDiv && secondsSpan) {
                this.timerDiv.className = 'timer-visible'
                secondsSpan.innerText = seconds.toString()
            }
        })

        this.socket.on(GAME_EVENTS.STOP_COUNTDOWN, () => {
            this.timerDiv.className = 'timer-hidden'
        })
    }

    private renderPlayers(players: SurvivalRoomUpdateType) {
        const list = document.getElementById('player-list')!

        list.innerHTML = players.map(p => `
            <div class='player-row'>
                <span>${p.name}</span>
                <span class='status-badge ${p.ready ? 'status-ready' : 'status-not-ready'}'>
                    ${p.ready ? 'READY' : 'NOT READY'}
                </span>
            </div>
        `).join('')
    }

    public hide() {
        this.lobbyElement.style.display = 'none'
        this.timerDiv.className = 'timer-hidden'
        this.readyBtn.innerText = 'READY!'
        this.readyHelpText.innerText = `If you're ready press the button ⬇️`
        this.readyBtn.classList.remove('not-ready')
        this.readyBtn.classList.add('ready')
    }
}