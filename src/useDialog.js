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

export function useDialog(onClose) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  // Mantener el ref actualizado fuera de render (la regla react-hooks/refs
  // prohíbe escribir refs durante el render).
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const node = ref.current;
    const previouslyFocused = typeof document !== 'undefined' ? document.activeElement : null;

    // Foco inicial: primer elemento enfocable del diálogo, o el contenedor.
    if (node) {
      const first = node.querySelector(FOCUSABLE);
      (first || node).focus();
    }

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
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
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, []);

  return ref;
}
