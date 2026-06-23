import { useState } from "react";
import { DEFAULT_DIMENSIONS } from "../../lib/aporte";

// Editor de las dimensiones de aporte (pesos que suman 100%). Owner-only.
// Extraído del monolito (H-002).
export default function DimensionEditor({ dimensions, setDimensions }) {
  const local = Array.isArray(dimensions) && dimensions.length ? dimensions : DEFAULT_DIMENSIONS;
  const [newLabel, setNewLabel] = useState("");

  const total = local.reduce((s, d) => s + (d.weight || 0), 0);

  const redistributeWeights = (dims) => {
    const t = dims.reduce((s, d) => s + (d.weight || 0), 0);
    if (t === 0 || dims.length === 0) return dims;
    let adjusted = dims.map(d => ({ ...d, weight: Math.round((d.weight / t) * 100) }));
    const diff = 100 - adjusted.reduce((s, d) => s + d.weight, 0);
    if (diff !== 0) adjusted[0] = { ...adjusted[0], weight: adjusted[0].weight + diff };
    return adjusted;
  };

  const updateWeight = (key, rawVal) => {
    const val = Math.min(100, Math.max(0, Number(rawVal) || 0));
    const others = local.filter(d => d.key !== key);
    const remaining = 100 - val;
    const sumOthers = others.reduce((s, d) => s + (d.weight || 0), 0);
    const next = local.map(d => {
      if (d.key === key) return { ...d, weight: val };
      if (sumOthers === 0) return { ...d, weight: Math.floor(remaining / others.length) };
      return { ...d, weight: Math.round((d.weight / sumOthers) * remaining) };
    });
    const diff = 100 - next.reduce((s, d) => s + d.weight, 0);
    if (diff !== 0 && next.length > 1) {
      const idx = next.findIndex(d => d.key !== key);
      next[idx] = { ...next[idx], weight: next[idx].weight + diff };
    }
    setDimensions(next);
  };

  const updateLabel = (key, label) => {
    const next = local.map(d => d.key === key ? { ...d, label } : d);
    setDimensions(next);
  };

  const addDimension = () => {
    const label = newLabel.trim();
    if (!label) return;
    const key = `dim_${Date.now()}`;
    const base = Math.floor(100 / (local.length + 1));
    const newDim = { key, label, weight: base, builtin: false };
    const next = redistributeWeights([...local.map(d => ({ ...d, weight: Math.max(1, Math.floor(d.weight * local.length / (local.length + 1))) })), newDim]);
    setDimensions(next);
    setNewLabel("");
  };

  const removeDimension = (key) => {
    const next = redistributeWeights(local.filter(d => d.key !== key));
    if (next.length === 0) return;
    setDimensions(next);
  };

  const si = { background: "#fafafa", border: "1px solid #e0e0e0", borderRadius: 6, padding: "5px 8px", fontSize: 12, outline: "none", fontFamily: "inherit", color: "#2d2d2d" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} onMouseDown={e => e.stopPropagation()}>
      {local.map((dim) => (
        <div key={dim.key} style={{ background: "#fafafa", borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(84,44,156,0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <input
              style={{ ...si, flex: 1, fontWeight: 600 }}
              value={dim.label}
              onChange={e => updateLabel(dim.key, e.target.value)}
              onBlur={() => setDimensions(local)}
              placeholder="Nombre de la dimensión"
            />
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="number" min={0} max={100} step={1}
                value={dim.weight}
                onChange={e => updateWeight(dim.key, e.target.value)}
                style={{ ...si, width: 52, textAlign: "center", fontWeight: 700 }}
              />
              <span style={{ fontSize: 12, color: "#888" }}>%</span>
            </div>
            {!dim.builtin && (
              <button
                onClick={() => removeDimension(dim.key)}
                style={{ background: "#fde8e8", border: "1px solid #f5c6c6", color: "#c0392b", borderRadius: 6, padding: "4px 9px", cursor: "pointer", fontSize: 13, flexShrink: 0 }}
              >✕</button>
            )}
          </div>
          <input
            type="range" min={0} max={100} step={1} value={dim.weight}
            onChange={e => updateWeight(dim.key, e.target.value)}
            style={{ width: "100%", cursor: "pointer", accentColor: "#ec6c04" }}
          />
        </div>
      ))}

      {/* Add new dimension */}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <input
          style={{ ...si, flex: 1, padding: "8px 12px" }}
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addDimension()}
          placeholder="Nueva dimensión (ej: Impacto en cliente)..."
        />
        <button
          onClick={addDimension}
          style={{ background: "linear-gradient(135deg,#542c9c,#6e3ebf)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}
        >+ Agregar</button>
      </div>

      <div style={{
        fontSize: 12, color: total === 100 ? "#27ae60" : "#c0392b",
        textAlign: "center", background: total === 100 ? "#e8f8ee" : "#fde8e8",
        borderRadius: 8, padding: "8px 12px", fontWeight: 700, transition: "all 0.2s",
      }}>
        Total: {total}% {total !== 100 && "(debe sumar 100%)"}
      </div>
    </div>
  );
}
