'use client';

// Botón para exportar la ficha a PDF (Imprimir → Guardar como PDF).
export default function ExportButton() {
    return (
        <button
            onClick={() => window.print()}
            style={{ background: '#212322', color: '#fff', border: 0, padding: '8px 16px', fontFamily: 'var(--font-sans)', fontSize: 13, cursor: 'pointer' }}
        >
            Exportar PDF
        </button>
    );
}
