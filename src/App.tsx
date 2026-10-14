import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// route-split: phones download + parse only the login screen first,
// chats and the rest load on demand afterwards
const ChatPage = lazy(() => import('./pages/ChatPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const SignupPage = lazy(() => import('./pages/SignupPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const JoinPage = lazy(() => import('./pages/JoinPage'))
const DebugPage = lazy(() => import('./pages/DebugPage'))

const queryClient = new QueryClient()

function Splash() {
  return (
    <div className="h-screen flex flex-col items-center justify-center gap-3 bg-brand-600">
      <img src="/logo.jpg" className="w-16 h-16 rounded-full object-cover" alt="" />
      <div className="w-8 h-8 rounded-full border-4 border-white/30 border-t-white animate-spin" />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="h-screen">
          <Suspense fallback={<Splash />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/join/:id" element={<JoinPage />} />
              <Route path="/debug" element={<DebugPage />} />
              <Route path="/" element={<ChatPage />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
