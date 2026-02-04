import type { Socket } from 'socket.io-client'
import { GAME_EVENTS } from '../../../../shared/consts'

export class SurvivalLobby {
    private socket: Socket
    private lobbyElement: HTMLElement

    constructor(socket: Socket) {
        this.socket = socket
        this.lobbyElement = document.getElementById('survival-lobby')!
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
        const readyBtn = document.getElementById('ready-toggle-btn') as HTMLButtonElement
        const readyHelpText = document.getElementById('ready-help-text') as HTMLButtonElement
        
        readyBtn.onclick = () => {
            this.socket.emit(GAME_EVENTS.TOGGLE_READY, roomId)

            readyBtn.classList.toggle('ready')
            readyBtn.classList.toggle('not-ready')
            readyBtn.innerText = readyBtn.classList.contains('ready') ? 'READY!' : 'NOT READY'

            readyHelpText.innerText = readyHelpText.innerText.includes('Not ready') 
                ? `If you're ready`
                : 'Not ready?'
            readyHelpText.innerText += ' press the button ⬇️'
        }

        this.socket.on(GAME_EVENTS.ROOM_UPDATE, (data) => {
            this.renderPlayers(data.players)
        })

        this.socket.on(GAME_EVENTS.STARTING_COUNTDOWN, (seconds: number) => {
            const timerDiv = document.getElementById('lobby-timer')
            const secondsSpan = document.getElementById('timer-seconds')

            if (timerDiv && secondsSpan) {
                timerDiv.className = 'timer-visible'
                secondsSpan.innerText = seconds.toString()
            }
        })

        this.socket.on(GAME_EVENTS.STOP_COUNTDOWN, () => {
            const timerDiv = document.getElementById('lobby-timer')

            if (timerDiv) {
                timerDiv.className = 'timer-hidden'
            }
        })
    }

    private renderPlayers(players: any[]) {
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
    }
}