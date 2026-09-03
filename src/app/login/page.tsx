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
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Solo Google: code -> backend Pulppo (/login) -> custom token -> Firebase user
    // -> idToken verificado en el server (allowlist + cookies cm-user/cm-name).
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
                const idToken = await cred.user.getIdToken();
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idToken })
                });
                const d = await res.json().catch(() => ({}));
                // Asesor → Studio; master broker → panel de su inmobiliaria; equipo interno → dashboard.
                // el master elige entre su panel y Studio; el asesor entra directo a Studio
                if (res.ok) router.push(d.asesorId ? '/studio/index.html' : (d.companyId ? '/inicio' : '/'));
                else setError(d.error || 'No se pudo ingresar');
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión con Google.');
            } finally {
                setLoading(false);
            }
        },
        onError: () => setError('Se canceló el login con Google.')
    });

    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0d0e0d] px-4">
            {/* glow de marca */}
            <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-[#F6BE00] opacity-[0.07] blur-3xl" />
            <div className="pointer-events-none absolute -bottom-52 left-1/4 h-[400px] w-[600px] rounded-full bg-[#529999] opacity-[0.06] blur-3xl" />

            <div className="relative w-full max-w-md">
                <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-10 shadow-2xl backdrop-blur-xl">
                    <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-lg">
                        <img src="/pulppo-icon.png" alt="Pulppo" className="h-10 w-10" />
                    </div>
                    <p className="text-center font-serif text-2xl tracking-wide text-white">pulppo</p>

                    <h1 className="mt-1 text-center font-serif text-3xl tracking-wide text-[#F6BE00]">
                        Inmobiliarias Pulppo
                    </h1>
                    <p className="mt-2 text-center text-sm font-light text-neutral-400">
                        Centro de mando del programa de exclusivas
                    </p>

                    <div className="mx-auto mt-6 mb-8 h-px w-16 bg-[#F6BE00]/60" />

                    <button
                        onClick={() => googleLogin()}
                        disabled={loading}
                        className="group flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-5 py-3.5 text-sm font-semibold text-[#212322] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(246,190,0,0.25)] disabled:translate-y-0 disabled:opacity-60"
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
                            <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
                        </svg>
                        {loading ? 'Ingresando…' : 'Continuar con Google'}
                    </button>

                    {error && (
                        <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-2.5 text-center text-xs text-red-300">
                            {error}
                        </p>
                    )}

                    <p className="mt-8 text-center text-[11px] font-light text-neutral-500">
                        Acceso exclusivo del equipo Pulppo con cuenta de Google.
                    </p>
                </div>

                <p className="mt-6 text-center text-[11px] text-neutral-600">Inmobiliarias Pulppo</p>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
            <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#0d0e0d] text-white">Cargando…</div>}>
                <LoginContent />
            </Suspense>
        </GoogleOAuthProvider>
    );
}
