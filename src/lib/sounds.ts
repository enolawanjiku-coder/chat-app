// All sounds are synthesized with Web Audio — no files needed, works offline.
const MUTE_KEY = 'sc-sound-muted'

export function isMuted(): boolean {
  return localStorage.getItem(MUTE_KEY) === '1'
}

export function setMuted(m: boolean): void {
  localStorage.setItem(MUTE_KEY, m ? '1' : '0')
}

let ctx: AudioContext | null = null
function audio(): AudioContext | null {
  if (isMuted()) return null
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tone(freq: number, start: number, dur: number, vol = 0.15, type: OscillatorType = 'sine'): void {
  const ac = audio()
  if (!ac) return
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, ac.currentTime + start)
  gain.gain.linearRampToValueAtTime(vol, ac.currentTime + start + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + start + dur)
  osc.connect(gain).connect(ac.destination)
  osc.start(ac.currentTime + start)
  osc.stop(ac.currentTime + start + dur + 0.05)
}

/** soft pop on incoming message */
export function playPop(): void {
  tone(660, 0, 0.12, 0.12)
  tone(880, 0.07, 0.14, 0.1)
}

/** swoosh on send */
export function playSend(): void {
  tone(520, 0, 0.08, 0.08, 'triangle')
  tone(780, 0.05, 0.1, 0.08, 'triangle')
}

/** very soft tick when someone starts typing (played once per typing session) */
export function playTick(): void {
  tone(1200, 0, 0.05, 0.04)
}

// ---- ringing (looping two-tone, US-style ring) ----
let ringTimer: number | null = null

export function startRing(outgoing: boolean): void {
  stopRing()
  const pattern = () => {
    if (outgoing) {
      // classic ring-ring: 440+480 for 1s, pause 2s
      tone(440, 0, 1, 0.12)
      tone(480, 0, 1, 0.12)
    } else {
      // incoming: lively triple chime
      tone(880, 0, 0.18, 0.14)
      tone(880, 0.25, 0.18, 0.14)
      tone(1174, 0.5, 0.3, 0.14)
    }
  }
  pattern()
  ringTimer = window.setInterval(pattern, outgoing ? 3000 : 1500)
}

export function stopRing(): void {
  if (ringTimer !== null) {
    clearInterval(ringTimer)
    ringTimer = null
  }
}

/** short connected blip */
export function playConnected(): void {
  tone(660, 0, 0.1, 0.12)
  tone(990, 0.1, 0.15, 0.12)
}
