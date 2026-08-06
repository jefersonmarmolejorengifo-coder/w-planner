// Un único sitio donde se decide si una escritura de Supabase realmente ocurrió.
//
// POR QUÉ EXISTE
// Comprobar una escritura tiene dos mitades, y la segunda se olvidó en cuatro
// archivos distintos antes de escribir esto:
//   1. `error` — lo devuelve un INSERT rechazado (42501), un constraint (23505),
//      un fallo de red…
//   2. **cero filas** — un UPDATE o un DELETE que la RLS deniega NO devuelve
//      error: devuelve una lista vacía. Mirar solo `error` deja pasar el fallo
//      entero, en silencio, y la pantalla muestra un cambio que la base nunca
//      aceptó.
// Es el mismo mecanismo que mantuvo oculto durante meses el bug de las
// invitaciones (ver src/lib/joinProject.js).
//
// CÓMO SE USA
// La consulta debe terminar en `.select('id')` para que la base devuelva las
// filas afectadas y se pueda distinguir "denegado" de "guardado":
//
//   const { ok, error } = await applyWrite(
//     supabase.from('okrs').update(payload).eq('id', id).select('id')
//   );
//   if (!ok) { toast('No se pudo guardar: ' + error.message); return; }
//
// Para escrituras donde no esperas filas de vuelta, pasa { expectRows: false }.
// Nunca lanza: siempre devuelve { ok, error }.

const ERROR_CERO_FILAS = {
  code: 'ZERO_ROWS',
  message: 'el servidor no aplicó el cambio (no tienes permisos sobre este tablero)',
};

export const applyWrite = async (query, { expectRows = true } = {}) => {
  const { data, error } = await query;
  if (error) return { ok: false, error };
  if (expectRows && Array.isArray(data) && data.length === 0) {
    return { ok: false, error: ERROR_CERO_FILAS };
  }
  return { ok: true, error: null, data };
};

// Mensaje corto y accionable para el usuario, con el código a la vista para que
// un reporte de soporte sirva de algo.
export const describeWriteError = (error) =>
  error?.code && error.code !== 'ZERO_ROWS'
    ? `${error.message} (${error.code})`
    : (error?.message || 'error desconocido');
