// Estilos de input compartidos por formularios (TaskForm, AuthScreen,
// ProjectLandingScreen, …). Extraídos del monolito (H-002, núcleo fase A).
export const inp = {
  background: "#fafafa",
  border: "1.5px solid #e0e0e0",
  borderRadius: 8,
  color: "#2d2d2d",
  padding: "8px 12px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  outline: "none",
  fontFamily: "inherit",
  transition: "border-color 0.2s, box-shadow 0.2s",
};

export const readonlyInp = { ...inp, background: "#f4f4f4", color: "#969696", cursor: "default", border: "1.5px solid #e8e8e8" };
