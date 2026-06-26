import { useState } from "react";
import { AUTO_FIELD_SOURCE_LABELS, slugifyKey } from "../../lib/customFields";
import { useConfirm } from "../../ui/ConfirmDialog";

// Owner-only editor for the per-project custom card schema (task_field_defs).
// Soft-deletes on remove to preserve historical values inside tasks.custom_fields.
// Extraído del monolito (H-002).
const FIELD_TYPE_LABELS = {
  text:        'Texto corto (una línea)',
  textarea:    'Texto largo (multilínea)',
  date:        'Fecha',
  select:      'Lista desplegable (una opción)',
  multiselect: 'Multi-opción (pastillas, varias)',
  subitems:    'Sub-ítems con checkbox',
  auto:        'Campo automático (sistema)',
};

const FIELD_TYPE_HINTS = {
  text:        'Ej: "Cliente", "Código externo".',
  textarea:    'Ej: "Notas extendidas", "Riesgos".',
  date:        'Ej: "Fecha objetivo", "Vencimiento contractual".',
  select:      'Una sola opción. Configura la lista de valores.',
  multiselect: 'Varias opciones tipo pastilla. Configura la lista de valores.',
  subitems:    'Lista interna con texto + checkbox (similar a las sub-tareas).',
  auto:        'Lectura no editable. Elige qué columna del sistema reflejar.',
};

export default function FieldDefEditor({ defs = [], onAdd, onUpdate, onDelete, onReorder }) {
  const confirm = useConfirm();
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ label: '', type: 'text', required: false, show_on_card: false, show_in_presentation: false, options: '', source: 'created_at' });
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const inpStyle = { background: '#fafafa', border: '1.5px solid #e0e0e0', borderRadius: 8, padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' };
  const labelStyle = { display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#542c9c', marginBottom: 5 };
  const usedKeys = new Set(defs.filter(d => !d.deleted_at).map(d => d.key));

  const buildConfigFromDraft = (d) => {
    if (d.type === 'select' || d.type === 'multiselect') {
      const options = String(d.options || '')
        .split(/\r?\n|,/)
        .map(s => s.trim())
        .filter(Boolean);
      return { options, ...(d.type === 'multiselect' && d.maxSelections ? { maxSelections: Number(d.maxSelections) } : {}) };
    }
    if (d.type === 'auto') {
      return { source: d.source || 'created_at' };
    }
    if (d.type === 'text' && d.maxLength) return { maxLength: Number(d.maxLength) };
    if (d.type === 'textarea' && d.maxLength) return { maxLength: Number(d.maxLength) };
    if (d.type === 'subitems' && d.maxItems) return { maxItems: Number(d.maxItems) };
    return {};
  };

  const handleAdd = async () => {
    setError('');
    const label = draft.label.trim();
    if (!label) { setError('Pon una etiqueta para el campo.'); return; }
    let key = slugifyKey(label);
    // Avoid collisions with existing active keys.
    let n = 1;
    let candidate = key;
    while (usedKeys.has(candidate)) {
      n += 1;
      candidate = (key + '_' + n).slice(0, 50);
    }
    key = candidate;
    const config = buildConfigFromDraft(draft);
    if ((draft.type === 'select' || draft.type === 'multiselect') && (!config.options || !config.options.length)) {
      setError('Agrega al menos una opción (una por línea o separadas por coma).'); return;
    }
    setBusy(true);
    const { error: err } = await onAdd({
      key, label, type: draft.type,
      required: !!draft.required,
      show_on_card: !!draft.show_on_card,
      show_in_presentation: !!draft.show_in_presentation,
      config,
    });
    setBusy(false);
    if (err) {
      setError(err.message || 'Error al guardar el campo.');
      return;
    }
    setDraft({ label: '', type: 'text', required: false, show_on_card: false, show_in_presentation: false, options: '', source: 'created_at' });
    setShowNew(false);
  };

  const startEdit = (def) => {
    setEditingId(def.id);
    setEditDraft({
      label: def.label,
      required: !!def.required,
      show_on_card: !!def.show_on_card,
      show_in_presentation: !!def.show_in_presentation,
      options: (def.config?.options || []).join('\n'),
      source: def.config?.source || 'created_at',
      maxLength: def.config?.maxLength || '',
      maxItems: def.config?.maxItems || '',
      maxSelections: def.config?.maxSelections || '',
    });
    setError('');
  };

  const handleSaveEdit = async (def) => {
    if (!editDraft) return;
    setError('');
    const label = editDraft.label.trim();
    if (!label) { setError('La etiqueta no puede ir vacía.'); return; }
    const patch = {
      label,
      required: !!editDraft.required,
      show_on_card: !!editDraft.show_on_card,
      show_in_presentation: !!editDraft.show_in_presentation,
      config: buildConfigFromDraft({ ...editDraft, type: def.type }),
    };
    setBusy(true);
    const { error: err } = await onUpdate(def.id, patch);
    setBusy(false);
    if (err) { setError(err.message || 'Error al guardar.'); return; }
    setEditingId(null);
    setEditDraft(null);
  };

  const handleDelete = async (def) => {
    if (!(await confirm(`¿Eliminar el campo "${def.label}"? Los valores ya capturados quedarán archivados.`, { title: 'Eliminar campo', confirmText: 'Eliminar', danger: true }))) return;
    setBusy(true);
    const { error: err } = await onDelete(def.id);
    setBusy(false);
    if (err) setError(err.message || 'Error al eliminar.');
  };

  const move = async (def, dir) => {
    const ordered = [...defs].sort((a, b) => (a.position - b.position) || (a.id - b.id));
    const idx = ordered.findIndex(d => d.id === def.id);
    if (idx < 0) return;
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= ordered.length) return;
    const next = [...ordered];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    await onReorder(next.map(d => d.id));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {defs.length === 0 ? (
        <p style={{ fontSize: 12, color: '#888', textAlign: 'center', padding: '12px 0' }}>
          Aún no hay campos personalizados. Agrega el primero para que aparezca en cada tarjeta.
        </p>
      ) : (
        defs.map((def) => (
          <div key={def.id} style={{ background: '#fafafa', borderRadius: 8, border: '1px solid rgba(84,44,156,0.08)', padding: '10px 12px' }}>
            {editingId === def.id ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Etiqueta</label>
                    <input style={inpStyle} value={editDraft.label} onChange={(e) => setEditDraft(d => ({ ...d, label: e.target.value }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Tipo (no editable)</label>
                    <input style={{ ...inpStyle, background: '#f0f0f0', color: '#888' }} value={FIELD_TYPE_LABELS[def.type] || def.type} readOnly />
                  </div>
                </div>
                {def.type === 'auto' && (
                  <div>
                    <label style={labelStyle}>Origen automático</label>
                    <select style={inpStyle} value={editDraft.source} onChange={(e) => setEditDraft(d => ({ ...d, source: e.target.value }))}>
                      {Object.entries(AUTO_FIELD_SOURCE_LABELS).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
                    </select>
                  </div>
                )}
                {(def.type === 'select' || def.type === 'multiselect') && (
                  <div>
                    <label style={labelStyle}>Opciones (una por línea)</label>
                    <textarea style={{ ...inpStyle, minHeight: 70 }} value={editDraft.options} onChange={(e) => setEditDraft(d => ({ ...d, options: e.target.value }))} />
                  </div>
                )}
                {def.type === 'multiselect' && (
                  <div>
                    <label style={labelStyle}>Máx. selecciones (opcional)</label>
                    <input style={inpStyle} type="number" min="1" max="50" value={editDraft.maxSelections} onChange={(e) => setEditDraft(d => ({ ...d, maxSelections: e.target.value }))} />
                  </div>
                )}
                {(def.type === 'text' || def.type === 'textarea') && (
                  <div>
                    <label style={labelStyle}>Máx. caracteres (opcional)</label>
                    <input style={inpStyle} type="number" min="1" value={editDraft.maxLength} onChange={(e) => setEditDraft(d => ({ ...d, maxLength: e.target.value }))} />
                  </div>
                )}
                {def.type === 'subitems' && (
                  <div>
                    <label style={labelStyle}>Máx. sub-ítems (opcional)</label>
                    <input style={inpStyle} type="number" min="1" max="50" value={editDraft.maxItems} onChange={(e) => setEditDraft(d => ({ ...d, maxItems: e.target.value }))} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 12 }}>
                  {def.type !== 'auto' && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#525252' }}>
                      <input type="checkbox" checked={editDraft.required} onChange={(e) => setEditDraft(d => ({ ...d, required: e.target.checked }))} />
                      Requerido
                    </label>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#525252' }}>
                    <input type="checkbox" checked={editDraft.show_on_card} onChange={(e) => setEditDraft(d => ({ ...d, show_on_card: e.target.checked }))} />
                    Mostrar en tarjeta resumida
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#525252' }}>
                    <input type="checkbox" checked={!!editDraft.show_in_presentation} onChange={(e) => setEditDraft(d => ({ ...d, show_in_presentation: e.target.checked }))} />
                    Mostrar en Presentación
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button disabled={busy} onClick={() => handleSaveEdit(def)} style={{ background: 'linear-gradient(135deg, #ec6c04, #f07d1e)', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    Guardar
                  </button>
                  <button disabled={busy} onClick={() => { setEditingId(null); setEditDraft(null); setError(''); }} style={{ background: '#fff', border: '1px solid #e0e0e0', color: '#525252', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12 }}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#2d2d2d' }}>{def.label}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <span>🔖 {FIELD_TYPE_LABELS[def.type] || def.type}</span>
                    <span>· clave: <code style={{ fontSize: 11 }}>{def.key}</code></span>
                    {def.required && <span style={{ color: '#c0392b' }}>· requerido</span>}
                    {def.show_on_card && <span style={{ color: '#149cac' }}>· en tarjeta</span>}
                    {def.show_in_presentation && <span style={{ color: '#ef7218' }}>· en presentación</span>}
                    {def.type === 'auto' && def.config?.source && <span>· origen: {AUTO_FIELD_SOURCE_LABELS[def.config.source] || def.config.source}</span>}
                  </div>
                </div>
                <button onClick={() => move(def, 'up')} title="Subir" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }}>▲</button>
                <button onClick={() => move(def, 'down')} title="Bajar" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }}>▼</button>
                <button onClick={() => startEdit(def)} style={{ background: '#ede8f8', border: '1px solid #d4c4f0', color: '#542c9c', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Editar</button>
                <button onClick={() => handleDelete(def)} style={{ background: '#fde8e8', border: '1px solid #f5c6c6', color: '#c0392b', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>✕</button>
              </div>
            )}
          </div>
        ))
      )}

      {showNew ? (
        <div style={{ background: '#fff', borderRadius: 8, border: '1.5px dashed #a78bda', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Etiqueta visible</label>
              <input style={inpStyle} value={draft.label} onChange={(e) => setDraft(d => ({ ...d, label: e.target.value }))} placeholder="Ej: Cliente, Riesgo, Próxima acción..." />
            </div>
            <div>
              <label style={labelStyle}>Tipo de campo</label>
              <select style={inpStyle} value={draft.type} onChange={(e) => setDraft(d => ({ ...d, type: e.target.value }))}>
                {Object.entries(FIELD_TYPE_LABELS).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#888' }}>{FIELD_TYPE_HINTS[draft.type]}</div>

          {draft.type === 'auto' && (
            <div>
              <label style={labelStyle}>Origen automático</label>
              <select style={inpStyle} value={draft.source} onChange={(e) => setDraft(d => ({ ...d, source: e.target.value }))}>
                {Object.entries(AUTO_FIELD_SOURCE_LABELS).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
              </select>
            </div>
          )}
          {(draft.type === 'select' || draft.type === 'multiselect') && (
            <div>
              <label style={labelStyle}>Opciones (una por línea o separadas por coma)</label>
              <textarea style={{ ...inpStyle, minHeight: 70 }} value={draft.options} onChange={(e) => setDraft(d => ({ ...d, options: e.target.value }))} placeholder={'Opción A\nOpción B\nOpción C'} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 12 }}>
            {draft.type !== 'auto' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#525252' }}>
                <input type="checkbox" checked={draft.required} onChange={(e) => setDraft(d => ({ ...d, required: e.target.checked }))} />
                Requerido
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#525252' }}>
              <input type="checkbox" checked={draft.show_on_card} onChange={(e) => setDraft(d => ({ ...d, show_on_card: e.target.checked }))} />
              Mostrar en tarjeta resumida
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#525252' }}>
              <input type="checkbox" checked={!!draft.show_in_presentation} onChange={(e) => setDraft(d => ({ ...d, show_in_presentation: e.target.checked }))} />
              Mostrar en Presentación
            </label>
          </div>

          {error && <div style={{ fontSize: 12, color: '#c0392b' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={busy} onClick={handleAdd} style={{ background: 'linear-gradient(135deg, #ec6c04, #f07d1e)', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              {busy ? 'Guardando…' : 'Agregar campo'}
            </button>
            <button disabled={busy} onClick={() => { setShowNew(false); setError(''); }} style={{ background: '#fff', border: '1px solid #e0e0e0', color: '#525252', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => { setShowNew(true); setError(''); }} style={{ alignSelf: 'flex-start', background: '#f5f0ff', border: '1px dashed #a78bda', color: '#542c9c', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          + Nuevo campo personalizado
        </button>
      )}

      {error && !showNew && <div style={{ fontSize: 12, color: '#c0392b' }}>{error}</div>}
    </div>
  );
}
