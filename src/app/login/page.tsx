'use client';

import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/lib/firebase';

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

function LoginContent() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Crea la sesión (valida allowlist + setea cookies cm-user/cm-name).
    async function ingresar(mail: string, nombre: string) {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: mail, name: nombre })
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok) router.push('/');
        else setError(d.error || 'No se pudo ingresar');
    }

    async function submitEmail(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError('');
        await ingresar(email, name);
        setLoading(false);
    }

    // Login con Google igual que pulppo-tools: code -> backend Pulppo (/login) -> custom token
    // -> Firebase user -> tomamos el email verificado -> sesión local.
    const googleLogin = useGoogleLogin({
        flow: 'auth-code',
        onSuccess: async (codeResponse) => {
            setError('');
            setLoading(true);
            try {
                if (!auth) throw new Error('Firebase no configurado.');
                const r = await fetch(`${API_URL}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: codeResponse.code })
                });
                const data = await r.json().catch(() => ({}));
                if (!data.firebase_token) throw new Error(data.error || 'No se pudo autenticar con Google.');
                const cred = await signInWithCustomToken(auth, data.firebase_token);
                const mail = (cred.user.email || '').toLowerCase();
                if (!mail) throw new Error('Google no devolvió un email.');
                await ingresar(mail, cred.user.displayName || '');
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión con Google.');
            } finally {
                setLoading(false);
            }
        },
        onError: () => setError('Se canceló el login con Google.')
    });

    return (
        <div className="flex min-h-screen items-center justify-center bg-black px-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-7">
                <img src="/pulppo-logo.png" alt="Pulppo" className="mx-auto mb-6 w-28 opacity-80" />
                <h1 className="text-center text-lg font-bold text-slate-900">Centro de mando · 1·5·10</h1>
                <p className="mt-1 mb-5 text-center text-sm text-slate-500">Ingresá con tu cuenta de Pulppo.</p>

                <button
                    onClick={() => googleLogin()}
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                    <svg className="h-4 w-4" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
                        <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
                    </svg>
                    {loading ? 'Ingresando…' : 'Ingresar con Google'}
                </button>

                <div className="my-4 flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="h-px flex-1 bg-slate-200" /> o con tu email <span className="h-px flex-1 bg-slate-200" />
                </div>

                <form onSubmit={submitEmail}>
                    <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="tu@pulppo.com"
                        className="mb-2 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-500"
                    />
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Tu nombre (opcional)"
                        className="mb-3 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-slate-500"
                    />
                    {error && <p className="mb-3 text-xs text-red-500">{error}</p>}
                    <button type="submit" disabled={loading} className="w-full rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
                        {loading ? 'Ingresando…' : 'Entrar'}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
            <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-black text-white">Cargando…</div>}>
                <LoginContent />
            </Suspense>
        </GoogleOAuthProvider>
    );
}
