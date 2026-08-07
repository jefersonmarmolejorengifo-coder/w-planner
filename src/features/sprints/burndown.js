// Normalización de fechas para el burndown. Vive fuera de SprintsTab.jsx
// porque exportar una función desde un archivo de componente rompe el fast
// refresh de Vite, y porque así se puede probar sin montar React.

// `finalizedAt` se guarda con toLocaleString("es-CO") → "06/08/2026, 14:30",
// mientras que el eje del burndown habla ISO ("2026-08-06"). Compararlos con >
// como cadenas no da error: da un resultado que depende del primer dígito del
// DÍA. Una tarea cerrada el 25 salía como pendiente para siempre; una cerrada
// el 6, como terminada desde el día cero. La gráfica siempre parecía plausible.
export const isoDeFinalizacion = (valor) => {
  if (!valor) return null;
  const fecha = String(valor).split(' ')[0].replace(/,$/, '');
  const m = fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); // dd/mm/aaaa
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null; // ya venía en ISO
};
