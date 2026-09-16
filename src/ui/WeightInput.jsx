import { useId, useState } from "react";
import { formatWeight, isTypeableWeightText, parseWeight } from "../lib/superTaskWeight";

// Input de peso (mayor que 0, hasta 1, máximo 2 decimales) para los enlaces
// tarea → super-tarea. Compartido por TaskForm (TaskSuperLinksEditor) y
// SuperTaskCreatorModal — junto a Toast/ConfirmDialog, vive en src/ui/.
//
// POR QUÉ type="text" y no type="number": en locale español ese input
// muestra la coma como separador y el navegador pisa valores intermedios
// ("0." se lee como "" al leer .value), así que era imposible teclear "0.5".
// Este componente parsea el texto a mano (acepta punto o coma) y solo
// confirma cuando ya es un número válido.
//
// Uso:
//   <WeightInput
//     value={weight}                       // number | string guardado
//     onCommit={(n) => guardar(n)}          // se llama con un número válido
//     ariaLabel={`peso de ${title}`}        // texto accesible del campo
//     disabled={busy}                        // opcional
//     style={{ width: 60, borderColor: c }}  // opcional, se fusiona sobre el base
//   />
export default function WeightInput({ value, onCommit, ariaLabel, disabled = false, style }) {
  const hintId = useId();
  const [draft, setDraft] = useState(() => formatWeight(value));
  const [focused, setFocused] = useState(false);
  // Último `value` que ya quedó reflejado en `draft`. Sirve para el ajuste
  // de estado DURANTE el render de abajo (patrón oficial de React para
  // "adjust state when a prop changes"): no se usa un useEffect a propósito
  // — un efecto correría un frame tarde y el valor viejo se alcanzaría a ver.
  const [syncedValue, setSyncedValue] = useState(value);

  // Se sincroniza desde la prop solo cuando el input NO tiene el foco: si
  // sincronizara siempre, cada guardado en el servidor (o un cambio del
  // padre) pisaría lo que la persona está tecleando a mitad de camino.
  if (!focused && value !== syncedValue) {
    setSyncedValue(value);
    setDraft(formatWeight(value));
  }

  // Inválido solo mientras la persona edita: un valor guardado fuera de
  // rango (p. ej. 1.5 de datos viejos) que nadie tocó no debe verse en rojo.
  const invalid = focused && parseWeight(draft) === null;

  const handleFocus = (e) => {
    setFocused(true);
    e.target.select(); // escribir reemplaza el valor, sin tener que borrarlo
  };

  const handleBlur = () => {
    setFocused(false);
    // Deja `draft` en formatWeight(value): si lo tecleado era inválido,
    // vuelve al último valor bueno; si era válido, normaliza la vista
    // ("0,5" → "0.5"). Se hace acá (no en el ajuste de arriba) porque cubre
    // también el caso en que `value` no cambió (campo vaciado sin confirmar).
    setDraft(formatWeight(value));
    setSyncedValue(value);
  };

  const handleChange = (e) => {
    const text = e.target.value;
    if (!isTypeableWeightText(text)) {
      // Tecla ignorada. Como no cambia el estado, React no re-renderiza por
      // su cuenta para deshacer el carácter: se restaura el valor nativo del
      // input a mano para que no se vea, ni por un instante, lo inválido.
      e.target.value = draft;
      return;
    }
    setDraft(text);
    const parsed = parseWeight(text);
    if (parsed !== null && parsed !== Number(value)) {
      onCommit(parsed);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); // no enviar el formulario que lo contenga
      e.currentTarget.blur();
    }
  };

  const { borderColor: customBorderColor, ...restStyle } = style || {};
  const borderColor = invalid ? "#c0392b" : (customBorderColor || "#ccc");

  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={ariaLabel}
        aria-invalid={invalid}
        aria-describedby={hintId}
        disabled={disabled}
        value={draft}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        style={{
          width: 64,
          padding: "4px 6px",
          borderRadius: 5,
          fontSize: 12,
          textAlign: "center",
          outline: "none",
          fontFamily: "inherit",
          ...restStyle,
          border: `1px solid ${borderColor}`,
        }}
      />
      <span
        id={hintId}
        role={invalid ? "alert" : undefined}
        style={
          invalid
            ? { fontSize: 10, color: "#c0392b", marginLeft: 4 }
            : { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }
        }
      >
        De 0.01 a 1
      </span>
    </>
  );
}
