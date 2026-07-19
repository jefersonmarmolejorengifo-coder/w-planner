// Identidad legal de la entidad responsable de Productivity-Plus.
//
// POR QUÉ un archivo aparte (y no meterlo en site.js):
//   Estos datos (NIT, domicilio, teléfono) los usan las 3 páginas legales
//   (privacidad.astro, tratamiento-datos.astro, terminos.astro) y solo ellas.
//   Centralizarlos evita repetir el NIT y la dirección en 3 archivos distintos
//   -si cambia el domicilio o el correo de contacto, se edita en un solo lugar-.
//   Mismo patrón que usa TuAgendaApp (apps/business-web/src/lib/legal/identidad.ts).
export const EMPRESA = 'Soft a Tu Medida S.A.S.';
export const NIT = '902.072.842-5';
export const DIRECCION = 'Carrera 19 # 33H-13';
export const CIUDAD = 'Cali, Valle del Cauca';
export const PAIS = 'Colombia';
export const TELEFONO = '+57 315 464 2460';

// Un solo correo para contacto general y para ejercer derechos de datos
// (habeas data). A diferencia de otras apps de Soft a Tu Medida que separan
// ambos canales, para Productivity-Plus se definió un único correo.
export const CORREO = 'info@softatumedida.com';
export const CORREO_DERECHOS = CORREO;

// Fecha de entrada en vigencia de las 3 políticas (se actualiza a mano si
// se publica una versión nueva).
export const VIGENCIA = '18 de julio de 2026';
