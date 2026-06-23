// Tarjeta-sección reutilizable (título + contenido) usada por Configuración y
// sus sub-secciones. Extraída del monolito (H-002). data-tour permite anclar el tour.
export function ConfigSection({ title, children, tourId }) {
  return (
    <div data-tour={tourId} style={{ background: "#ffffff", border: "none", borderRadius: 14, padding: 20, boxShadow: "0 2px 16px rgba(84,44,156,0.07)" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#542c9c", marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}
