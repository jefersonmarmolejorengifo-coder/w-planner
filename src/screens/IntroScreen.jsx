import { useState, useEffect } from "react";

// ─── IntroScreen ───────────────────────────────────────────
export default function IntroScreen({ onFinish }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 300);
    const t2 = setTimeout(() => setPhase(2), 1000);
    const t3 = setTimeout(() => setPhase(3), 2000);
    const t4 = setTimeout(() => setPhase(4), 3000);
    const t5 = setTimeout(() => onFinish(), 4200);
    return () => [t1,t2,t3,t4,t5].forEach(clearTimeout);
  }, [onFinish]);

  return (
    <div
      onClick={onFinish}
      style={{
        position: "fixed", inset: 0, background: "#0d0d1a",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        zIndex: 9999, cursor: "pointer", overflow: "hidden",
        opacity: phase === 4 ? 0 : 1,
        transition: phase === 4 ? "opacity 0.9s ease" : "none",
      }}
    >
      <style>{`
        @keyframes expandLine { from { width: 0; opacity: 0; } to { width: 100%; opacity: 1; } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
        @keyframes glowPulse {
          0%, 100% { text-shadow: 0 0 40px rgba(236,108,4,0.4), 0 0 80px rgba(236,108,4,0.2); }
          50%       { text-shadow: 0 0 60px rgba(236,108,4,0.8), 0 0 120px rgba(236,108,4,0.4); }
        }
        @keyframes drawBorder { from { stroke-dashoffset: 600; } to { stroke-dashoffset: 0; } }
        @keyframes floatParticle {
          0%   { transform: translateY(0px) translateX(0px); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translateY(-120px) translateX(20px); opacity: 0; }
        }
        @keyframes scanLine { from { top: 0%; } to { top: 100%; } }
        @keyframes counterUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Fondo con grid perspectiva */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage:
          "linear-gradient(rgba(20,156,172,0.06) 1px, transparent 1px), " +
          "linear-gradient(90deg, rgba(20,156,172,0.06) 1px, transparent 1px)",
        backgroundSize: "60px 60px",
        opacity: phase >= 1 ? 1 : 0, transition: "opacity 1.2s ease",
      }} />

      {/* Gradiente radial central */}
      <div style={{
        position: "absolute", width: 600, height: 600, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(84,44,156,0.18) 0%, transparent 70%)",
        opacity: phase >= 1 ? 1 : 0, transition: "opacity 1s ease",
      }} />

      {/* Línea de scan */}
      {phase >= 1 && phase < 4 && (
        <div style={{
          position: "absolute", left: 0, right: 0, height: 1,
          background: "linear-gradient(90deg, transparent, rgba(236,108,4,0.6), transparent)",
          animation: "scanLine 2.5s linear infinite", zIndex: 1,
        }} />
      )}

      {/* Partículas flotantes */}
      {phase >= 1 && [
        { left:"15%", delay:"0s",   size:3, color:"#ec6c04" },
        { left:"25%", delay:"0.4s", size:2, color:"#149cac" },
        { left:"40%", delay:"0.8s", size:4, color:"#542c9c" },
        { left:"55%", delay:"0.2s", size:2, color:"#ec6c04" },
        { left:"68%", delay:"0.6s", size:3, color:"#149cac" },
        { left:"78%", delay:"1s",   size:2, color:"#542c9c" },
        { left:"88%", delay:"0.3s", size:3, color:"#ec6c04" },
        { left:"10%", delay:"0.7s", size:2, color:"#149cac" },
      ].map((p, i) => (
        <div key={i} style={{
          position: "absolute", bottom: "10%", left: p.left,
          width: p.size, height: p.size, borderRadius: "50%",
          background: p.color, boxShadow: `0 0 6px ${p.color}`,
          animation: `floatParticle ${2.5 + i * 0.3}s ${p.delay} ease-in-out infinite`,
        }} />
      ))}

      {/* Contenido central */}
      <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>

        {/* SVG Marco animado */}
        {phase >= 1 && (
          <div style={{
            position: "absolute", top: -60, left: -80,
            width: "calc(100% + 160px)", height: "calc(100% + 120px)",
            opacity: phase >= 2 ? 0.6 : 0, transition: "opacity 0.8s ease", pointerEvents: "none",
          }}>
            <svg width="100%" height="100%" viewBox="0 0 500 200" preserveAspectRatio="none">
              <rect x="2" y="2" width="496" height="196" rx="8" fill="none"
                stroke="url(#borderGrad)" strokeWidth="1"
                strokeDasharray="600" strokeDashoffset="600"
                style={{ animation: "drawBorder 1.2s ease forwards 0.5s" }}
              />
              <defs>
                <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%"   stopColor="#ec6c04" stopOpacity="0.8" />
                  <stop offset="50%"  stopColor="#149cac" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#542c9c" stopOpacity="0.8" />
                </linearGradient>
              </defs>
              <line x1="2"   y1="30"  x2="2"   y2="2"   stroke="#ec6c04" strokeWidth="2" opacity="0.9"/>
              <line x1="2"   y1="2"   x2="30"  y2="2"   stroke="#ec6c04" strokeWidth="2" opacity="0.9"/>
              <line x1="498" y1="170" x2="498" y2="198" stroke="#ec6c04" strokeWidth="2" opacity="0.9"/>
              <line x1="498" y1="198" x2="470" y2="198" stroke="#ec6c04" strokeWidth="2" opacity="0.9"/>
            </svg>
          </div>
        )}

        {/* Logo P+ */}
        <div style={{
          fontSize: 100, fontWeight: 900, lineHeight: 1,
          background: "linear-gradient(135deg, #ec6c04 0%, #f5a623 40%, #149cac 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
          opacity: phase >= 1 ? 1 : 0,
          transform: phase >= 1 ? "scale(1)" : "scale(0.5)",
          transition: "all 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)",
          animation: phase >= 2 ? "glowPulse 2.5s ease infinite" : "none",
          letterSpacing: -4, marginBottom: 8,
        }}>P+</div>

        {/* Línea separadora */}
        <div style={{
          height: 1,
          background: "linear-gradient(90deg, transparent, #ec6c04, #149cac, #542c9c, transparent)",
          marginBottom: 16,
          opacity: phase >= 2 ? 1 : 0,
          animation: phase >= 2 ? "expandLine 0.6s ease forwards" : "none",
          width: phase >= 2 ? "100%" : 0,
        }} />

        {/* Nombre del producto */}
        <div style={{
          fontSize: 28, fontWeight: 300, color: "#ffffff",
          letterSpacing: 14, textTransform: "uppercase",
          opacity: phase >= 2 ? 1 : 0,
          animation: phase >= 2 ? "fadeUp 0.7s ease forwards" : "none",
          marginBottom: 6,
        }}>PRODUCTIVITY-PLUS</div>

        {/* Subtítulo */}
        <div style={{
          fontSize: 11, fontWeight: 400, color: "rgba(255,255,255,0.45)",
          letterSpacing: 5, textTransform: "uppercase",
          opacity: phase >= 3 ? 1 : 0,
          animation: phase >= 3 ? "fadeIn 0.8s ease forwards" : "none",
          marginBottom: 0,
        }}>Productivity-Plus · Gestión Estratégica</div>

        {/* Línea inferior */}
        <div style={{
          marginTop: 16, height: 1,
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)",
          width: "100%",
          opacity: phase >= 2 ? 1 : 0,
          animation: phase >= 2 ? "expandLine 0.6s ease 0.2s forwards" : "none",
        }} />
      </div>

      {/* Indicador de carga */}
      {phase >= 3 && (
        <div style={{
          position: "absolute", bottom: 40,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
          animation: "fadeIn 0.5s ease forwards",
        }}>
          <div style={{ width: 200, height: 2, background: "rgba(255,255,255,0.1)", borderRadius: 1, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              background: "linear-gradient(90deg, #ec6c04, #149cac)",
              borderRadius: 1,
              width: phase >= 3 ? "100%" : "0%",
              transition: "width 1s ease",
            }} />
          </div>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: 3, textTransform: "uppercase" }}>Iniciando sistema</span>
        </div>
      )}

      {/* Hint clic */}
      {phase >= 3 && (
        <div style={{
          position: "absolute", bottom: 16, right: 20,
          fontSize: 10, color: "rgba(255,255,255,0.2)", letterSpacing: 2,
          animation: "fadeIn 0.5s ease forwards",
        }}>
          clic para continuar
        </div>
      )}
    </div>
  );
}
