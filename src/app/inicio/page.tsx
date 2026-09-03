'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/* ------------------------------------------------------------------ *
 * /inicio — Menú del master broker.
 *
 * Antes el login lo mandaba directo a /mb/{company} y el middleware lo
 * dejaba encerrado ahí, así que un titular NUNCA podía llegar a Studio
 * aunque el bundle sí le arma perfil (el generador incluye associate y
 * master). Resultado: 425 titulares en la red con un perfil inalcanzable.
 *
 * Este menú es el punto medio: entra y elige. No se le da acceso a nada
 * nuevo — sólo a las dos cosas que ya son suyas.
 *
 * cm-company es httpOnly:false y sirve únicamente para armar el link; la
 * barrera real (canAccessCompany / currentAsesorId) se recalcula
 * server-side y no confía en esta cookie.
 * ------------------------------------------------------------------ */

function cookie(nombre: string): string {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + nombre + '=([^;]+)'));
    try {
        return m ? decodeURIComponent(m[1]).trim() : '';
    } catch {
        return '';
    }
}

export default function InicioMaster() {
    const router = useRouter();
    const [company, setCompany] = useState('');
    const [nombre, setNombre] = useState('');

    useEffect(() => {
        setCompany(cookie('cm-company'));
        setNombre(cookie('cm-name'));
    }, []);

    async function logout() {
        await fetch('/api/auth/login', { method: 'DELETE' });
        router.push('/login');
    }

    const opciones = [
        {
            href: '/studio/index.html',
            eyebrow: 'Contenido',
            title: 'Studio',
            blurb: 'Qué publicar hoy y la pieza lista para bajar, armada con tu perfil, tus zonas y tus operaciones.',
            cta: 'Ver lo de hoy'
        },
        {
            href: company ? `/mb/${company}` : '/login',
            eyebrow: 'Tu inmobiliaria',
            title: 'Análisis de inventario',
            blurb: 'Qué inventario necesita atención, cómo van tus leads, tus zonas y tu equipo.',
            cta: 'Abrir el panel'
        }
    ];

    return (
        <div className="mx-auto max-w-[760px] px-7 py-10">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-[1.5px] text-brand-gray">Pulppo</p>
                    <div className="my-[9px] h-0.5 w-[52px] bg-brand-yellow" />
                    <h1 className="text-[32px]">{nombre ? `Hola, ${nombre}` : 'Hola'}</h1>
                    <p className="mt-0.5 text-xs text-brand-gray">¿Con qué quieres trabajar?</p>
                </div>
                <div className="flex items-center gap-3">
                    <img src="/pulppo-icon.png" alt="Pulppo" className="h-9 w-9" />
                    <button
                        onClick={logout}
                        className="rounded-[2px] border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">
                        Salir
                    </button>
                </div>
            </header>

            <div className="mt-9 grid gap-5 sm:grid-cols-2">
                {opciones.map((o, i) => (
                    <a
                        key={o.title}
                        href={o.href}
                        className="group flex flex-col rounded-[2px] border border-neutral-200 bg-white p-6 transition-colors hover:bg-light">
                        <p className="text-[10px] font-bold uppercase tracking-[1.2px] text-brand-gray">{o.eyebrow}</p>
                        <h2 className="mt-1 text-[26px] leading-none">{o.title}</h2>
                        <p className="mt-2.5 flex-1 text-[13px] leading-relaxed text-neutral-500">{o.blurb}</p>
                        <span
                            className={`mt-5 flex items-baseline justify-between gap-3 rounded-[2px] px-4 py-3 ${
                                i === 0 ? 'bg-[#212322]' : 'border border-neutral-200 bg-white'
                            }`}>
                            <span className={`text-[13px] font-bold ${i === 0 ? 'text-white' : 'text-soft'}`}>{o.cta}</span>
                            <span className={`text-sm ${i === 0 ? 'text-brand-yellow' : 'text-sea'}`}>→</span>
                        </span>
                    </a>
                ))}
            </div>
        </div>
    );
}
