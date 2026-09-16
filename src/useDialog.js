import { useEffect, useRef } from 'react';

// Hook de accesibilidad para diálogos modales (H-008).
// Devuelve un ref que se adjunta al contenedor del diálogo y se encarga de:
//   - foco inicial dentro del diálogo al montar,
//   - trampa de foco (Tab/Shift+Tab no salen del diálogo),
//   - cierre con Escape,
//   - devolver el foco al elemento que lo tenía antes de abrir, al desmontar.
// El contenedor debe tener tabIndex={-1} y role="dialog" aria-modal="true".

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Pila de diálogos abiertos, compartida por TODAS las instancias de este hook
// en la app. Cada listener de 'keydown' se registra en `document` (no en el
// nodo del diálogo), así que con dos diálogos montados a la vez (p. ej. "tarjeta"
// + "¿Descartar cambios?" encima) hay DOS listeners en el mismo document.
// `stopPropagation()` no sirve para que el listener más viejo se calle: eso
// solo frena la propagación hacia otros nodos, no hacia otros listeners del
// MISMO nodo. Sin esta pila, Escape disparaba los dos onClose a la vez y
// cerraba de un tirón el diálogo de confirmación Y la tarjeta de fondo.
let openDialogStack = [];

export function useDialog(onClose) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  // Mantener el ref actualizado fuera de render (la regla react-hooks/refs
  // prohíbe escribir refs durante el render).
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const node = ref.current;
    const previouslyFocused = typeof document !== 'undefined' ? document.activeElement : null;
    const dialogId = {}; // identidad estable de esta instancia dentro de la pila
    openDialogStack.push(dialogId);

    // Foco inicial: primer elemento enfocable del diálogo, o el contenedor.
    if (node) {
      const first = node.querySelector(FOCUSABLE);
      (first || node).focus();
    }

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        // Solo el diálogo de encima (el último abierto) reacciona a Escape.
        // Los que quedaron debajo (p. ej. la tarjeta, mientras se confirma un
        // descarte) se ignoran y siguen abiertos con lo que tenían.
        if (openDialogStack[openDialogStack.length - 1] !== dialogId) return;
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key === 'Tab' && node) {
        const items = Array.from(node.querySelectorAll(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement
        );
        if (items.length === 0) {
          e.preventDefault();
          node.focus();
          return;
        }
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      openDialogStack = openDialogStack.filter((id) => id !== dialogId);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, []);

  return ref;
}
