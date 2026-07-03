import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth } from 'firebase/auth';

// Firebase Auth de Pulppo (mismo proyecto que las otras herramientas). La config va en
// NEXT_PUBLIC_FIREBASE (JSON), igual que en customer-cx / pulppo-tools-frontend.
const apps = getApps();
let app: FirebaseApp | undefined = apps[0];
let provider: GoogleAuthProvider | undefined;

if (typeof window !== 'undefined') {
    if (!app) {
        const firebaseConfig = JSON.parse(process.env.NEXT_PUBLIC_FIREBASE || '{}');
        app = initializeApp(firebaseConfig);
    }
    provider = new GoogleAuthProvider();
    provider.setDefaultLanguage('es');
    provider.addScope('profile');
    provider.addScope('email');
    provider.setCustomParameters({ prompt: 'select_account' });
}

export const auth = typeof window !== 'undefined' && app ? getAuth(app) : null;
export { provider, app };
