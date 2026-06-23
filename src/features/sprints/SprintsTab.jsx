import { useState } from "react";
import { supabase } from "../../supabaseClient";
import { STATUS_COLORS } from "../../constants";

// Tab de Sprints (planificación + activo + cerrados, con burndown). Extraído del
// monolito (H-002), cargado con React.lazy. SprintCard y los estilos puros viven
// a nivel de módulo (antes SprintCard era un componente-en-render que se remontaba
// en cada render); los handlers se pasan por props.

const btn = (v) => ({ border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12, padding: '6px 14px', transition: 'all 0.2s', background: v === 'green' ? 'linear-gradient(135deg,#27ae60,#2ecc71)' : v === 'danger' ? 'linear-gradient(135deg,#c0392b,#e74c3c)' : v === 'primary' ? 'linear-gradient(135deg,#542c9c,#6e3ebf)' : '#f4f4f4', color: (v === 'green' || v === 'danger' || v === 'primary') ? '#fff' : '#666' });
const si = { background: '#fafafa', border: '1.5px solid #e0e0e0', borderRadius: 8, color: '#2d2d2d', padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' };

function SprintCard({ sprint, tasks, today, onStart, onCloseSprint, onDelete }) {
  const spTasks = tasks.filter(t => t.sprintId === sprint.id);
  const done = spTasks.filter(t => t.status === 'Finalizada').length;
  const blocked = spTasks.filter(t => t.status === 'Bloqueada').length;
  const pct = spTasks.length ? Math.round((done / spTasks.length) * 100) : 0;
  const isActive = sprint.status === 'active';
  const isPlanning = sprint.status === 'planning';
  const sc = isActive ? '#ec6c04' : isPlanning ? '#542c9c' : '#969696';

  // Burndown data
  const bdPoints = [];
  if (sprint.start_date && sprint.end_date && spTasks.length) {
    const start = new Date(sprint.start_date);
    const end = new Date(sprint.end_date);
    const days = Math.max(1, Math.ceil((end - start) / 86400000));
    for (let i = 0; i <= Math.min(days, 14); i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const ds = d.toISOString().split('T')[0];
      if (ds > today) break;
      const remaining = spTasks.filter(t => !t.finalizedAt || t.finalizedAt.split(' ')[0] > ds).length;
      bdPoints.push({ x: i, y: remaining });
    }
  }
  const bdMax = Math.max(1, spTasks.length);
  const BDW = 260, BDH = 70;

  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 2px 14px rgba(84,44,156,0.07)', marginBottom: 12, borderLeft: `4px solid ${sc}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#2d2d2d' }}>{sprint.name}</span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: isActive ? '#fff3ea' : '#f4f4f4', color: sc, textTransform: 'uppercase' }}>{sprint.status}</span>
          </div>
          {sprint.goal && <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{sprint.goal}</div>}
          <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#666', flexWrap: 'wrap' }}>
            {sprint.start_date && <span>📅 {sprint.start_date}</span>}
            {sprint.end_date && <span>🏁 {sprint.end_date}</span>}
            <span style={{ color: '#542c9c', fontWeight: 700 }}>{spTasks.length} tareas</span>
            {spTasks.length > 0 && <span style={{ color: '#27ae60', fontWeight: 600 }}>{done} ✓</span>}
            {blocked > 0 && <span style={{ color: '#c0392b', fontWeight: 600 }}>{blocked} bloq.</span>}
          </div>
          {spTasks.length > 0 && (
            <div style={{ marginTop: 8, height: 6, background: '#f0e8ff', borderRadius: 3, overflow: 'hidden', maxWidth: 240 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: pct >= 80 ? '#27ae60' : '#ec6c04', borderRadius: 3, transition: 'width 0.4s' }} />
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {isPlanning && <button onClick={() => onStart(sprint.id)} style={btn('green')}>▶ Iniciar</button>}
          {isActive && <button onClick={() => onCloseSprint(sprint.id)} style={btn()}>⏹ Cerrar</button>}
          <button onClick={() => onDelete(sprint.id)} style={{ ...btn('danger'), padding: '6px 10px' }}>🗑️</button>
        </div>
      </div>

      {bdPoints.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#542c9c', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Burndown</div>
          <svg width={BDW} height={BDH + 16} style={{ display: 'block', overflow: 'visible' }}>
            <line x1={0} y1={0} x2={BDW} y2={BDH} stroke="#ddd" strokeWidth={1} strokeDasharray="4" />
            <polyline points={bdPoints.map((p, i) => `${(i / Math.max(bdPoints.length - 1, 1)) * BDW},${(p.y / bdMax) * BDH}`).join(' ')} fill="none" stroke="#ec6c04" strokeWidth={2} strokeLinejoin="round" />
            {bdPoints.map((p, i) => <circle key={i} cx={(i / Math.max(bdPoints.length - 1, 1)) * BDW} cy={(p.y / bdMax) * BDH} r={3} fill="#ec6c04" />)}
            <text x={2} y={10} style={{ fontSize: 9, fill: '#aaa', fontFamily: 'inherit' }}>{bdMax}</text>
            <text x={2} y={BDH - 2} style={{ fontSize: 9, fill: '#aaa', fontFamily: 'inherit' }}>0</text>
          </svg>
        </div>
      )}

      {isActive && spTasks.length > 0 && (
        <div style={{ marginTop: 12, borderTop: '1px solid #f0e8ff', paddingTop: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#542c9c', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Tareas en este sprint</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {spTasks.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: '#fafafe', borderRadius: 6, border: '1px solid #e8e0f4' }}>
                <div style={{ width: 7, height: 7, borderRadius: 2, background: STATUS_COLORS[t.status] || '#888', flexShrink: 0 }} />
                <span style={{ fontSize: 12, flex: 1, color: '#2d2d2d' }}>#{t.id} {t.title}</span>
                <span style={{ fontSize: 10, color: STATUS_COLORS[t.status], fontWeight: 600 }}>{t.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SprintsTab({ projectId, sprints, setSprints, tasks }) {
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', goal: '', start_date: '', end_date: '' });
  const today = new Date().toISOString().split('T')[0];

  const activeSprint = sprints.find(s => s.status === 'active');

  const saveSprint = async () => {
    if (!form.name.trim()) return;
    const { data } = await supabase.from('sprints').insert({ ...form, project_id: projectId, status: 'planning' }).select().single();
    if (data) setSprints(prev => [...prev, data]);
    setForm({ name: '', goal: '', start_date: '', end_date: '' });
    setCreating(false);
  };

  const startSprint = async (id) => {
    if (activeSprint) { alert('Ya hay un sprint activo. Ciérralo antes de iniciar otro.'); return; }
    await supabase.from('sprints').update({ status: 'active' }).eq('id', id).eq('project_id', projectId);
    setSprints(prev => prev.map(s => s.id === id ? { ...s, status: 'active' } : s));
  };

  const closeSprint = async (id) => {
    await supabase.from('sprints').update({ status: 'closed' }).eq('id', id).eq('project_id', projectId);
    setSprints(prev => prev.map(s => s.id === id ? { ...s, status: 'closed' } : s));
  };

  const deleteSprint = async (id) => {
    if (!confirm('¿Eliminar este sprint?')) return;
    await supabase.from('sprints').delete().eq('id', id).eq('project_id', projectId);
    setSprints(prev => prev.filter(s => s.id !== id));
  };

  const active = sprints.filter(s => s.status === 'active');
  const planning = sprints.filter(s => s.status === 'planning');
  const closed = sprints.filter(s => s.status === 'closed');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#542c9c' }}>Sprints</div>
        <button onClick={() => setCreating(true)} style={{ ...btn('primary'), marginLeft: 'auto' }}>+ Nuevo sprint</button>
      </div>

      {creating && (
        <div style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 2px 14px rgba(84,44,156,0.07)', marginBottom: 16, border: '2px solid rgba(84,44,156,0.15)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#542c9c', marginBottom: 12 }}>Nuevo sprint</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div style={{ gridColumn: 'span 2' }}><input style={si} placeholder="Nombre del sprint *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus /></div>
            <div style={{ gridColumn: 'span 2' }}><input style={si} placeholder="Objetivo del sprint..." value={form.goal} onChange={e => setForm(f => ({ ...f, goal: e.target.value }))} /></div>
            <input type="date" style={si} value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            <input type="date" style={si} value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={saveSprint} style={btn('primary')}>Guardar</button>
            <button onClick={() => { setCreating(false); setForm({ name: '', goal: '', start_date: '', end_date: '' }); }} style={btn()}>Cancelar</button>
          </div>
        </div>
      )}

      {active.length > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: '#ec6c04', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Sprint activo</div>}
      {active.map(s => <SprintCard key={s.id} sprint={s} tasks={tasks} today={today} onStart={startSprint} onCloseSprint={closeSprint} onDelete={deleteSprint} />)}

      {planning.length > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: '#542c9c', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, marginTop: 16 }}>En planificación</div>}
      {planning.map(s => <SprintCard key={s.id} sprint={s} tasks={tasks} today={today} onStart={startSprint} onCloseSprint={closeSprint} onDelete={deleteSprint} />)}

      {closed.length > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: '#969696', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, marginTop: 16 }}>Cerrados</div>}
      {closed.map(s => <SprintCard key={s.id} sprint={s} tasks={tasks} today={today} onStart={startSprint} onCloseSprint={closeSprint} onDelete={deleteSprint} />)}

      {sprints.length === 0 && !creating && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#969696', fontSize: 14 }}>
          No hay sprints registrados.<br /><span style={{ fontSize: 12 }}>Crea un sprint para organizar el trabajo en ciclos cortos.</span>
        </div>
      )}
    </div>
  );
}
