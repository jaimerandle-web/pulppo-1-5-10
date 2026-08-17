'use client';

import { useRouter } from 'next/navigation';

/* ------------------------------------------------------------------ *
 * / — Menú. La raíz ya no es el dashboard de 1·5·10 (ése vive en
 * /1-5-10): es el índice de los proyectos que conviven en esta app.
 * /ficha/[id] NO aparece aquí a propósito — no es un proyecto, es una
 * vista compartida que abren tanto 1·5·10 como Master Brokers.
 * ------------------------------------------------------------------ */

type Link = { href: string; label: string; hint: string };

const PROYECTOS: { eyebrow: string; title: string; blurb: string; links: Link[] }[] = [
    {
        eyebrow: 'Programa de exclusivas',
        title: '1 · 5 · 10',
        blurb: 'Cartera y operación del programa: pipeline de ofertas y ventas, desempeño por propiedad, alertas y recap mensual para bonos.',
        links: [
            { href: '/1-5-10', label: 'Cartera y programa', hint: 'Pipeline, métricas, alertas y recap' },
            { href: '/1-5-10/evaluar', label: 'Evaluar elegibilidad', hint: '¿Esta propiedad entra al programa?' },
            { href: '/1-5-10/campanas', label: 'Campañas de email', hint: 'Digest por zona: planear, aprobar y programar' }
        ]
    },
    {
        eyebrow: 'Inmobiliarias',
        title: 'Master Brokers',
        blurb: 'La herramienta del dueño de la inmobiliaria: qué inventario necesita atención, cómo van sus leads, sus zonas y su equipo.',
        links: [
            { href: '/mb', label: 'Índice de inmobiliarias', hint: 'Filtra por KAM y abre la de cada una' },
            { href: '/analisis', label: 'Análisis general', hint: 'El mismo motor, configurable para el reporte del KAM' }
        ]
    },
    {
        eyebrow: 'Contenido',
        title: 'Studio',
        blurb: 'Le propone al asesor qué publicar hoy y le entrega la pieza lista para bajar, armada con su perfil, sus zonas y sus operaciones.',
        links: [
            // Piloto: HTML estático servido desde public/, protegido por el mismo middleware que el
            // resto. Cuando el asesor pueda entrar con su cuenta pasa a ser una ruta propia.
            { href: '/studio/index.html', label: 'Piloto · Diamond House', hint: '19 asesores, datos en vivo' }
        ]
    }
];

export default function Menu() {
    const router = useRouter();

    async function logout() {
        await fetch('/api/auth/login', { method: 'DELETE' });
        router.push('/login');
    }

    return (
        <div className="mx-auto max-w-[1080px] px-7 py-10">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-[1.5px] text-brand-gray">Pulppo · Interno</p>
                    <div className="my-[9px] h-0.5 w-[52px] bg-brand-yellow" />
                    <h1 className="text-[32px]">Herramientas</h1>
                    <p className="mt-0.5 text-xs text-brand-gray">Datos en vivo desde Mongo. Elige con qué vas a trabajar.</p>
                </div>
                <div className="flex items-center gap-3">
                    <img src="/pulppo-icon.png" alt="Pulppo" className="h-9 w-9" />
                    <button onClick={logout} className="rounded-[2px] border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">
                        Salir
                    </button>
                </div>
            </header>

            <div className="mt-9 grid gap-5 md:grid-cols-2">
                {PROYECTOS.map((p) => (
                    <section key={p.title} className="rounded-[2px] border border-neutral-200 bg-white p-6">
                        <p className="text-[10px] font-bold uppercase tracking-[1.2px] text-brand-gray">{p.eyebrow}</p>
                        <h2 className="mt-1 text-[26px] leading-none">{p.title}</h2>
                        <p className="mt-2.5 text-[13px] leading-relaxed text-neutral-500">{p.blurb}</p>

                        <div className="mt-5 flex flex-col gap-2">
                            {p.links.map((l, i) => (
                                <a key={l.href} href={l.href}
                                    className={`group flex items-baseline justify-between gap-3 rounded-[2px] border px-4 py-3 transition-colors ${i === 0
                                        ? 'border-transparent bg-[#212322] hover:bg-black'
                                        : 'border-neutral-200 bg-white hover:bg-light'}`}>
                                    <span>
                                        <span className={`block text-[13px] font-bold ${i === 0 ? 'text-white' : 'text-soft'}`}>{l.label}</span>
                                        <span className={`mt-0.5 block text-[11px] ${i === 0 ? 'text-neutral-400' : 'text-brand-gray'}`}>{l.hint}</span>
                                    </span>
                                    <span className={`text-sm ${i === 0 ? 'text-brand-yellow' : 'text-sea'}`}>→</span>
                                </a>
                            ))}
                        </div>
                    </section>
                ))}
            </div>

            <p className="mt-8 text-[10px] text-brand-gray">
                Acceso por allowlist interno. La ficha de propiedad (<span className="font-mono">/ficha/…</span>) es
                compartida por ambos proyectos y se abre desde adentro de cada uno.
            </p>
        </div>
    );
}
