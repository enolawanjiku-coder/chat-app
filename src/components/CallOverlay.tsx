import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react'
import type { ActiveCall, IncomingCall } from '../hooks/useCalls'

function Timer({ startedAt }: { startedAt: number }) {
  const [s, setS] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setS(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(t)
  }, [startedAt])
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return <span>{mm}:{ss}</span>
}

export function CallOverlay({
  incoming,
  active,
  onAccept,
  onDecline,
  onEnd,
}: {
  incoming: IncomingCall | null
  active: ActiveCall | null
  onAccept: (withVideo: boolean) => void
  onDecline: () => void
  onEnd: () => void
}) {
  const remoteRef = useRef<HTMLVideoElement>(null)
  const localRef = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)

  useEffect(() => {
    if (remoteRef.current && active?.remoteStream) remoteRef.current.srcObject = active.remoteStream
  }, [active?.remoteStream])
  useEffect(() => {
    if (localRef.current && active?.localStream) localRef.current.srcObject = active.localStream
  }, [active?.localStream])

  const toggleMute = () => {
    const t = active?.localStream?.getAudioTracks()[0]
    if (t) {
      t.enabled = !t.enabled
      setMuted(!t.enabled)
    }
  }
  const toggleCam = () => {
    const t = active?.localStream?.getVideoTracks()[0]
    if (t) {
      t.enabled = !t.enabled
      setCamOff(!t.enabled)
    }
  }

  if (incoming && !active) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
        <div className="bg-white dark:bg-zinc-800 rounded-3xl p-6 w-full max-w-xs text-center space-y-4 shadow-2xl">
          <div className="w-20 h-20 mx-auto rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-3xl font-bold animate-pulse">
            {incoming.fromName.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className="font-bold text-lg dark:text-white">{incoming.fromName}</p>
            <p className="flex items-center justify-center gap-1.5 text-sm text-gray-500">
              {incoming.video ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />} Incoming {incoming.video ? 'video' : 'voice'} call…
            </p>
          </div>
          <div className="flex justify-center gap-4">
            <button onClick={onDecline} aria-label="Decline" className="w-14 h-14 rounded-full bg-red-500 text-white shadow active:scale-95 flex items-center justify-center"><PhoneOff className="w-6 h-6" /></button>
            <button onClick={() => onAccept(true)} aria-label="Accept" className="w-14 h-14 rounded-full bg-green-500 text-white shadow active:scale-95 flex items-center justify-center"><Phone className="w-6 h-6" /></button>
          </div>
          {incoming.video && <p className="text-[11px] text-gray-400">Accepts with your camera on — you can turn it off in-call</p>}
        </div>
      </div>
    )
  }

  if (!active) return null

  return (
    <div className="fixed inset-0 z-50 bg-[#0b141a] flex flex-col">
      {active.video ? (
        <div className="flex-1 relative min-h-0">
          <video ref={remoteRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
          {!active.remoteStream && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-24 h-24 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-4xl font-bold animate-pulse">
                {active.peerName.slice(0, 1).toUpperCase()}
              </div>
            </div>
          )}
          <video ref={localRef} autoPlay muted playsInline className="absolute bottom-4 right-4 w-28 h-40 object-cover rounded-2xl border-2 border-white/30 shadow" />
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="w-28 h-28 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-5xl font-bold animate-pulse">
            {active.peerName.slice(0, 1).toUpperCase()}
          </div>
          <p className="text-white font-bold text-xl">{active.peerName}</p>
          <p className="text-zinc-400 text-sm"><Timer startedAt={active.startedAt} /> · voice call</p>
          <audio ref={(el) => { if (el && active.remoteStream) (el as unknown as { srcObject: MediaStream }).srcObject = active.remoteStream }} autoPlay />
        </div>
      )}
      {active.video && (
        <p className="text-center text-zinc-300 text-sm py-1"><Timer startedAt={active.startedAt} /> · {active.peerName}</p>
      )}
      <div className="flex justify-center items-center gap-5 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <button onClick={toggleMute} aria-label="Mute" className={`w-14 h-14 rounded-full shadow flex items-center justify-center ${muted ? 'bg-red-500 text-white' : 'bg-zinc-700 text-white'}`}>
          {muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>
        {active.video && (
          <button onClick={toggleCam} aria-label="Camera" className={`w-14 h-14 rounded-full shadow flex items-center justify-center ${camOff ? 'bg-red-500 text-white' : 'bg-zinc-700 text-white'}`}>
            {camOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
          </button>
        )}
        <button onClick={onEnd} aria-label="End call" className="w-16 h-16 rounded-full bg-red-600 text-white shadow active:scale-95 flex items-center justify-center"><PhoneOff className="w-7 h-7" /></button>
      </div>
    </div>
  )
}
