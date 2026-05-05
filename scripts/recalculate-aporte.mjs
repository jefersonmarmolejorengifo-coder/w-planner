import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
// Leer variables de entorno desde .env.local
const envPath = resolve(__dirname, '../.env.local');
const envContent = readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach((line) => {
  const eqIdx = line.indexOf('=');
  if (eqIdx > 0) {
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim().replace(/^"|"$/g, '');
    env[key] = val;
  }
});
const supabase = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_ANON_KEY
);
// Fórmula exacta del WPlanner (misma que calcAporte en WPlanner.jsx)
const calcAporte = (task, weights) =>
  ((task.estimated_time || 1) * (weights.tiempo || 40) +
    (task.difficulty || 1) * (weights.dificultad || 30) +
    (task.strategic_value || 1) * (weights.estrategico || 30)) / 100;

async function main() {
  console.log('🔄 Productivity-Plus — Recálculo de aporteSnapshot\n');
  // 1. Obtener pesos actuales
  const { data: configData, error: configError } = await supabase
    .from('app_config')
    .select('key, value');
  if (configError) throw new Error('No se pudo leer app_config: ' + configError.message);
  const weightsRow = configData.find((r) => r.key === 'weights');
  let weights = { tiempo: 40, dificultad: 30, estrategico: 30 };
  if (weightsRow?.value) {
    try {
      weights = typeof weightsRow.value === 'string'
        ? JSON.parse(weightsRow.value)
        : weightsRow.value;
    } catch {
      console.warn('⚠️  No se pudo parsear weights, usando valores por defecto');
    }
  }
  console.log('📊 Pesos actuales:', weights);
  // 2. Obtener todas las tareas
  const { data: tasks, error: tasksError } = await supabase
    .from('tasks')
    .select('id, estimated_time, difficulty, strategic_value, aporte_snapshot');
  if (tasksError) throw new Error('No se pudo leer tasks: ' + tasksError.message);
  console.log(`📋 Tareas encontradas: ${tasks.length}\n`);
  // 3. Recalcular y actualizar una a una
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  for (const task of tasks) {
    const newAporte = parseFloat(calcAporte(task, weights).toFixed(1));
    const oldAporte = task.aporte_snapshot;
    const { error: updateError } = await supabase
      .from('tasks')
      .update({ aporte_snapshot: newAporte })
      .eq('id', task.id);

    if (updateError) {
      console.error(`  ❌ Tarea #${task.id}: ${updateError.message}`);
      errors++;
    } else {
      console.log(`  ✅ Tarea #${task.id}: ${oldAporte ?? 'null'} → ${newAporte}`);
      updated++;
    }
  }
  console.log('\n═══════════════════════════════');
  console.log(`✅ Actualizadas: ${updated}`);
  console.log(`⏭️  Con errores:  ${errors}`);
  console.log('═══════════════════════════════');
  console.log('\n🎉 Recálculo completado. Este script no volverá a necesitarse.');
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
