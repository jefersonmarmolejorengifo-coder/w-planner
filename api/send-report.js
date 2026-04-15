export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { emails, html, weekStart, weekEnd } = req.body;
  if (!emails?.length) return res.status(400).json({ error: "No hay correos configurados" });

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.REPORT_FROM_EMAIL || "onboarding@resend.dev",
        to: emails,
        subject: `Reporte Semanal Banco W · ${weekStart} al ${weekEnd}`,
        html,
      }),
    });
    const data = await response.json();
    if (data.error) throw new Error(JSON.stringify(data.error));
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
