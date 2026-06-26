import { useState } from "react";
import { supabase } from "../../supabaseClient";
import { useToast } from "../../ui/Toast";
import { useConfirm } from "../../ui/ConfirmDialog";

// Tab de OKRs (Objetivos y Resultados Clave). Prop-driven: recibe okrs/keyResults
// y sus setters desde el orquestador. Extraído del monolito (H-002), cargado con
// React.lazy.
export default function OKRsTab({ projectId, okrs, setOkrs, keyResults, setKeyResults, tasks }) {
  const toast = useToast();
  const confirm = useConfirm();
  // Default: hoy → +90 días (un trimestre aprox). El usuario puede ajustar.
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const in90ISO = () => { const d = new Date(); d.setDate(d.getDate() + 90); return d.toISOString().slice(0, 10); };
  const blankForm = () => ({ title: '', description: '', start_date: todayISO(), end_date: in90ISO() });

  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(blankForm());
  const [addingKrFor, setAddingKrFor] = useState(null);
  const [krForm, setKrForm] = useState({ title: '', target_value: 100, unit: '%' });

  const btn = (v) => ({ border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12, padding: '6px 14px', transition: 'all 0.2s', background: v === 'primary' ? 'linear-gradient(135deg,#542c9c,#6e3ebf)' : v === 'danger' ? 'linear-gradient(135deg,#c0392b,#e74c3c)' : '#f4f4f4', color: (v === 'primary' || v === 'danger') ? '#fff' : '#666' });
  const si = { background: '#fafafa', border: '1.5px solid #e0e0e0', borderRadius: 8, color: '#2d2d2d', padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' };

  const resetForm = () => { setForm(blankForm()); setCreating(false); setEditId(null); };

  const saveOkr = async () => {
    if (!form.title.trim()) return;
    if (!form.start_date || !form.end_date) { toast('Define fecha de inicio y fin', { type: 'error' }); return; }
    if (form.end_date < form.start_date) { toast('La fecha fin debe ser mayor o igual a la fecha inicio', { type: 'error' }); return; }
    const payload = { title: form.title, description: form.description, start_date: form.start_date, end_date: form.end_date };
    if (editId) {
      await supabase.from('okrs').update(payload).eq('id', editId).eq('project_id', projectId);
      setOkrs(prev => prev.map(o => o.id === editId ? { ...o, ...payload } : o));
    } else {
      const { data } = await supabase.from('okrs').insert({ ...payload, project_id: projectId, status: 'active' }).select().single();
      if (data) setOkrs(prev => [...prev, data]);
    }
    resetForm();
  };

  const deleteOkr = async (id) => {
    if (!(await confirm('¿Eliminar este objetivo y todos sus resultados clave?', { title: 'Eliminar objetivo', confirmText: 'Eliminar', danger: true }))) return;
    await supabase.from('okrs').delete().eq('id', id).eq('project_id', projectId);
    setOkrs(prev => prev.filter(o => o.id !== id));
    setKeyResults(prev => prev.filter(kr => kr.okr_id !== id));
  };

  const toggleStatus = async (okr) => {
    const ns = okr.status === 'active' ? 'closed' : 'active';
    await supabase.from('okrs').update({ status: ns }).eq('id', okr.id).eq('project_id', projectId);
    setOkrs(prev => prev.map(o => o.id === okr.id ? { ...o, status: ns } : o));
  };

  const saveKr = async () => {
    if (!krForm.title.trim() || !addingKrFor) return;
    const { data } = await supabase.from('key_results').insert({ ...krForm, okr_id: addingKrFor, project_id: projectId, current_value: 0 }).select().single();
    if (data) setKeyResults(prev => [...prev, data]);
    setKrForm({ title: '', target_value: 100, unit: '%' });
    setAddingKrFor(null);
  };

  const updateKrValue = async (kr, delta) => {
    const nv = Math.max(0, Math.min(Number(kr.target_value), Number(kr.current_value) + delta));
    await supabase.from('key_results').update({ current_value: nv }).eq('id', kr.id).eq('project_id', projectId);
    setKeyResults(prev => prev.map(k => k.id === kr.id ? { ...k, current_value: nv } : k));
  };

  const deleteKr = async (id) => {
    await supabase.from('key_results').delete().eq('id', id).eq('project_id', projectId);
    setKeyResults(prev => prev.filter(k => k.id !== id));
  };

  const getKrPct = (kr) => {
    const linked = tasks.filter(t => t.krId === kr.id);
    if (linked.length) return (linked.filter(t => t.status === 'Finalizada').length / linked.length) * 100;
    return Number(kr.target_value) > 0 ? (Number(kr.current_value) / Number(kr.target_value)) * 100 : 0;
  };

  // Agrupa por año del start_date; los más recientes primero.
  const grouped = {};
  okrs.forEach(o => {
    const y = o.start_date ? new Date(o.start_date).getFullYear() : new Date().getFullYear();
    if (!grouped[y]) grouped[y] = [];
    grouped[y].push(o);
  });
  Object.values(grouped).forEach(arr => arr.sort((a, b) => (b.start_date || '').localeCompare(a.start_date || '')));
  const periods = Object.keys(grouped).sort().reverse();

  const fmtRange = (start, end) => {
    if (!start || !end) return '';
    const s = new Date(start), e = new Date(end);
    const f = (d) => d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
    const sameYear = s.getFullYear() === e.getFullYear();
    return sameYear ? `${f(s)} – ${f(e)} ${e.getFullYear()}` : `${f(s)} ${s.getFullYear()} – ${f(e)} ${e.getFullYear()}`;
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#542c9c' }}>OKRs · Objetivos y Resultados Clave</div>
        <button onClick={() => { setCreating(true); setEditId(null); setForm(blankForm()); }} style={{ ...btn('primary'), marginLeft: 'auto' }}>+ Nuevo objetivo</button>
      </div>

      {(creating || editId) && (
        <div style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 2px 14px rgba(84,44,156,0.07)', marginBottom: 16, border: '2px solid rgba(84,44,156,0.15)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#542c9c', marginBottom: 12 }}>{editId ? 'Editar objetivo' : 'Nuevo objetivo'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div style={{ gridColumn: 'span 2' }}><input style={si} placeholder="Título del objetivo *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} autoFocus /></div>
            <div style={{ gridColumn: 'span 2' }}><input style={si} placeholder="Descripción (opcional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 4, fontWeight: 600 }}>FECHA INICIO *</div>
              <input type="date" style={si} value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 4, fontWeight: 600 }}>FECHA FIN *</div>
              <input type="date" style={si} value={form.end_date} min={form.start_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={saveOkr} style={btn('primary')}>Guardar</button>
            <button onClick={resetForm} style={btn()}>Cancelar</button>
          </div>
        </div>
      )}

      {okrs.length === 0 && !creating && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#969696', fontSize: 14 }}>
          No hay objetivos registrados.<br /><span style={{ fontSize: 12 }}>Crea objetivos para medir el progreso de tu equipo.</span>
        </div>
      )}

      {periods.map(period => (
        <div key={period} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#542c9c', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>{period}</div>
          {grouped[period].map(okr => {
            const krs = keyResults.filter(kr => kr.okr_id === okr.id);
            const avgPct = krs.length ? krs.reduce((s, kr) => s + getKrPct(kr), 0) / krs.length : 0;
            const isActive = okr.status === 'active';
            return (
              <div key={okr.id} style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 2px 14px rgba(84,44,156,0.07)', marginBottom: 12, borderLeft: `4px solid ${isActive ? '#542c9c' : '#ccc'}` }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#2d2d2d' }}>{okr.title}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: isActive ? '#e8f8ee' : '#f4f4f4', color: isActive ? '#27ae60' : '#969696', textTransform: 'uppercase' }}>{isActive ? 'Activo' : 'Cerrado'}</span>
                      <span style={{ fontSize: 11, color: '#542c9c', background: '#f0e8ff', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{fmtRange(okr.start_date, okr.end_date)}</span>
                    </div>
                    {okr.description && <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>{okr.description}</div>}
                    {krs.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, height: 8, background: '#f0e8ff', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${avgPct}%`, background: avgPct >= 80 ? '#27ae60' : avgPct >= 40 ? '#ec6c04' : '#c0392b', borderRadius: 4, transition: 'width 0.4s' }} />
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#542c9c', flexShrink: 0 }}>{avgPct.toFixed(0)}%</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => { setEditId(okr.id); setCreating(false); setForm({ title: okr.title, description: okr.description || '', start_date: okr.start_date || todayISO(), end_date: okr.end_date || in90ISO() }); }} style={{ ...btn(), padding: '6px 10px' }}>✏️</button>
                    <button onClick={() => toggleStatus(okr)} style={{ ...btn(), fontSize: 11 }}>{isActive ? '🔒 Cerrar' : '🔓 Reabrir'}</button>
                    <button onClick={() => deleteOkr(okr.id)} style={{ ...btn('danger'), padding: '6px 10px' }}>🗑️</button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {krs.map(kr => {
                    const pct = getKrPct(kr);
                    const linked = tasks.filter(t => t.krId === kr.id);
                    const fromTasks = linked.length > 0;
                    return (
                      <div key={kr.id} style={{ background: '#faf8ff', borderRadius: 10, padding: '10px 14px', border: '1px solid #e8e0f4' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#2d2d2d', flex: 1 }}>{kr.title}</span>
                          {!fromTasks && (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <button onClick={() => updateKrValue(kr, -10)} style={{ ...btn(), padding: '2px 8px' }}>−</button>
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#542c9c', minWidth: 60, textAlign: 'center' }}>{Number(kr.current_value)}/{Number(kr.target_value)} {kr.unit}</span>
                              <button onClick={() => updateKrValue(kr, 10)} style={{ ...btn(), padding: '2px 8px' }}>+</button>
                            </div>
                          )}
                          {fromTasks && (
                            <span style={{ fontSize: 11, color: '#542c9c', fontWeight: 600 }}>{linked.filter(t => t.status === 'Finalizada').length}/{linked.length} tareas</span>
                          )}
                          <button onClick={() => deleteKr(kr.id)} style={{ ...btn('danger'), padding: '2px 8px' }}>✕</button>
                        </div>
                        <div style={{ height: 5, background: '#e8e0f4', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: pct >= 80 ? '#27ae60' : pct >= 40 ? '#ec6c04' : '#c0392b', borderRadius: 3, transition: 'width 0.4s' }} />
                        </div>
                      </div>
                    );
                  })}

                  {addingKrFor === okr.id ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input style={{ ...si, flex: 2, minWidth: 160 }} placeholder="Resultado clave *" value={krForm.title} onChange={e => setKrForm(f => ({ ...f, title: e.target.value }))} autoFocus />
                      <input type="number" style={{ ...si, width: 70 }} placeholder="Meta" value={krForm.target_value} onChange={e => setKrForm(f => ({ ...f, target_value: Number(e.target.value) }))} />
                      <input style={{ ...si, width: 55 }} placeholder="%" value={krForm.unit} onChange={e => setKrForm(f => ({ ...f, unit: e.target.value }))} />
                      <button onClick={saveKr} style={btn('primary')}>✓</button>
                      <button onClick={() => { setAddingKrFor(null); setKrForm({ title: '', target_value: 100, unit: '%' }); }} style={btn()}>✕</button>
                    </div>
                  ) : isActive && (
                    <button onClick={() => setAddingKrFor(okr.id)} style={{ ...btn(), textAlign: 'left', fontSize: 11, padding: '5px 12px' }}>+ Agregar resultado clave</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
