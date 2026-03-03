import { initializeApp } from 'firebase/app'
import {
    createUserWithEmailAndPassword,
    getAuth,
    getRedirectResult,
    GoogleAuthProvider,
    signInWithEmailAndPassword,
    signInWithPopup,
    signInWithRedirect,
    updateProfile
} from 'firebase/auth'
import { isIOSWebView, showWebViewWarning } from './menus/login/utils'

const firebaseConfig = {
	apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
	authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
	projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
	storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
	appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)

getRedirectResult(auth).catch((error) => {
    console.error('Redirect auth error:', error)
})

export const googleProvider = new GoogleAuthProvider()
export const loginWithGoogle = async () => {
    if (isIOSWebView()) {
        showWebViewWarning()
        return
    }
    else {
        try {
            await signInWithPopup(auth, googleProvider)
        } catch (error: any) {
            if (error.code === 'auth/popup-blocked') {
                await signInWithRedirect(auth, googleProvider)
            }
            else {
                console.error('Auth error:', error)
            }
        }
    }
}

export const loginEmail = (email: string, pass: string) => 
    signInWithEmailAndPassword(auth, email, pass)

export const registerEmail = async (email: string, pass: string, username: string) => {
    try {
        const res = await createUserWithEmailAndPassword(auth, email, pass)
        await updateProfile(res.user, { displayName: username })

        await res.user.getIdToken(true)

        return res.user
    } catch (e) {
        throw e
    }
}