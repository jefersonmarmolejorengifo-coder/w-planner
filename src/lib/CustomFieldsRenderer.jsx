import { readCustomFieldValue } from "./customFields";

// CustomFieldsRenderer — renders a list of field defs as form inputs in
// `edit` mode or as labeled read-only values in `view` mode. Designed to be
// dropped inside the existing TaskForm grid (gridColumn: span 1 or span 2
// depending on def.config.half). Extraído del monolito (H-002).
export function CustomFieldsRenderer({ defs, task, onChange, mode = 'edit' }) {
  if (!Array.isArray(defs) || !defs.length) return null;
  const active = defs.filter(d => !d.deleted_at);
  if (!active.length) return null;

  const inpLocal = {
    background: '#fafafa', border: '1.5px solid #e0e0e0', borderRadius: 8,
    color: '#2d2d2d', padding: '8px 12px', fontSize: 13, width: '100%',
    boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  };
  const readonlyLocal = { ...inpLocal, background: '#f4f4f4', color: '#969696', cursor: 'default', border: '1.5px solid #e8e8e8' };

  const fieldWrap = (def, children) => (
    <div key={def.id} style={{ gridColumn: def.config?.half ? 'span 1' : 'span 2' }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#542c9c', marginBottom: 5 }}>
        {def.label}{def.required && def.type !== 'auto' ? ' *' : ''}
      </label>
      {children}
    </div>
  );

  const setVal = (key, val) => onChange && onChange(key, val);

  return (
    <>
      {active.map(def => {
        const value = readCustomFieldValue(def, task);

        if (def.type === 'auto') {
          return fieldWrap(def, <input style={readonlyLocal} readOnly value={value || ''} />);
        }

        if (mode === 'view') {
          // Compact read-only rendering for view-only contexts (detail panels).
          let display = '';
          if (def.type === 'multiselect' && Array.isArray(value)) display = value.join(', ');
          else if (def.type === 'subitems' && Array.isArray(value)) display = `${value.filter(i => i.done).length}/${value.length} completados`;
          else display = String(value ?? '');
          return fieldWrap(def, <input style={readonlyLocal} readOnly value={display} />);
        }

        if (def.type === 'text') {
          return fieldWrap(def, (
            <input
              style={inpLocal}
              value={value || ''}
              maxLength={def.config?.maxLength || 200}
              placeholder={def.config?.placeholder || ''}
              onChange={(e) => setVal(def.key, e.target.value)}
            />
          ));
        }

        if (def.type === 'textarea') {
          return fieldWrap(def, (
            <textarea
              style={{ ...inpLocal, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }}
              value={value || ''}
              maxLength={def.config?.maxLength || 2000}
              placeholder={def.config?.placeholder || ''}
              onChange={(e) => setVal(def.key, e.target.value)}
            />
          ));
        }

        if (def.type === 'date') {
          return fieldWrap(def, (
            <input
              type="date"
              style={inpLocal}
              value={value || ''}
              onChange={(e) => setVal(def.key, e.target.value)}
            />
          ));
        }

        if (def.type === 'select') {
          const options = Array.isArray(def.config?.options) ? def.config.options : [];
          return fieldWrap(def, (
            <select style={inpLocal} value={value || ''} onChange={(e) => setVal(def.key, e.target.value)}>
              <option value="">— Sin valor —</option>
              {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              {value && !options.includes(value) && <option value={value}>{value}</option>}
            </select>
          ));
        }

        if (def.type === 'multiselect') {
          const options = Array.isArray(def.config?.options) ? def.config.options : [];
          const selected = Array.isArray(value) ? value : [];
          const max = def.config?.maxSelections || options.length || 20;
          return fieldWrap(def, (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {options.length === 0 && (
                <span style={{ fontSize: 12, color: '#9ca3af' }}>Sin opciones configuradas.</span>
              )}
              {options.map(opt => {
                const isSel = selected.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      if (isSel) setVal(def.key, selected.filter(s => s !== opt));
                      else if (selected.length < max) setVal(def.key, [...selected, opt]);
                    }}
                    style={{
                      padding: '5px 10px', borderRadius: 999, fontSize: 12,
                      border: isSel ? '1.5px solid #542c9c' : '1px solid #d4d4d8',
                      background: isSel ? '#ede8f8' : '#fafafa',
                      color: isSel ? '#542c9c' : '#525252',
                      cursor: 'pointer', fontWeight: isSel ? 600 : 500, fontFamily: 'inherit',
                    }}
                  >
                    {isSel && <span style={{ marginRight: 4 }}>✓</span>}{opt}
                  </button>
                );
              })}
              {selected.length >= max && (
                <span style={{ fontSize: 11, color: '#9ca3af', alignSelf: 'center' }}>Máximo {max} selecciones</span>
              )}
            </div>
          ));
        }

        if (def.type === 'subitems') {
          const items = Array.isArray(value) ? value : [];
          const max = def.config?.maxItems || 20;
          const update = (next) => setVal(def.key, next);
          return fieldWrap(def, (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((it, i) => (
                // Use a stable per-item uid so editing/deleting one row
                // does not steal focus from another.
                <div key={it.uid || `idx-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!it.done}
                    onChange={() => {
                      const arr = items.map((x, idx) => idx === i ? { ...x, done: !x.done } : x);
                      update(arr);
                    }}
                  />
                  <input
                    style={{ ...inpLocal, flex: 1 }}
                    value={it.text || ''}
                    onChange={(e) => {
                      const arr = items.map((x, idx) => idx === i ? { ...x, text: e.target.value } : x);
                      update(arr);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => update(items.filter((_, idx) => idx !== i))}
                    style={{ background: '#fde8e8', border: '1px solid #f5c6c6', color: '#c0392b', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
                  >✕</button>
                </div>
              ))}
              {items.length < max && (
                <button
                  type="button"
                  onClick={() => {
                    const uid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    update([...items, { uid, text: '', done: false }]);
                  }}
                  style={{ alignSelf: 'flex-start', background: '#f5f0ff', border: '1px dashed #a78bda', color: '#542c9c', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                >+ Agregar sub-ítem</button>
              )}
            </div>
          ));
        }

        // Unknown type — render as plain readonly for forward compat.
        return fieldWrap(def, <input style={readonlyLocal} readOnly value={typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')} />);
      })}
    </>
  );
}
