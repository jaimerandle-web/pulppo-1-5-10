'use client';

import { useState } from 'react';

// Copia el link público (con token) de la ficha para compartir con brokers sin login.
export default function ShareButton({ id, token }: { id: string; token: string }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        const url = `${window.location.origin}/ficha/${id}?token=${token}`;
        try {
            await navigator.clipboard.writeText(url);
        } catch {
            window.prompt('Copia el link público:', url);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <button
            onClick={copy}
            style={{ background: '#529999', color: '#fff', border: 0, padding: '8px 16px', fontFamily: 'var(--font-sans)', fontSize: 13, cursor: 'pointer' }}
        >
            {copied ? 'Link copiado ✓' : 'Copiar link público'}
        </button>
    );
}
