import { signInWithPopup, signOut } from 'firebase/auth'
import { auth, googleProvider } from '../firebase'

export default function AuthButton({ user }) {
  if (!user) {
    return (
      <button className="btn btn-primary" onClick={() => signInWithPopup(auth, googleProvider)}>
        Sign in with Google
      </button>
    )
  }
  return (
    <div className="auth-user">
      {user.photoURL && <img src={user.photoURL} alt="" className="auth-avatar" referrerPolicy="no-referrer" />}
      <span className="auth-name">{user.displayName ?? user.email}</span>
      <button className="btn" onClick={() => signOut(auth)}>Sign out</button>
    </div>
  )
}
