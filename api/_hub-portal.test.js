// Tests de construirUrlPortalHub: el link firmado al panel central del Hub.
// Lo crítico: el formato de firma DEBE calzar con lo que el Hub verifica en
// lib/suscripciones/link-firmado.ts → HMAC-SHA256 sobre `${slug}.${ts}.${email}`.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { construirUrlPortalHub } from "./_hub-portal.js";

const SECRET = "test-secret-hmac-wplanner";

function setEnv() {
  process.env.HUB_WEBHOOK_URL = "https://panel.softatumedida.com/api/webhook-app";
  process.env.HUB_APP_SLUG = "w-planner";
  process.env.HUB_WEBHOOK_SECRET = SECRET;
}

beforeEach(setEnv);
afterEach(setEnv);

/** Re-deriva la firma como lo hace el Hub. */
function firmaEsperada(slug, ts, emailNorm) {
  return crypto.createHmac("sha256", SECRET).update(`${slug}.${ts}.${emailNorm}`).digest("hex");
}

describe("construirUrlPortalHub", () => {
  it("firma con el formato exacto que el Hub verifica", () => {
    const url = construirUrlPortalHub("jefe@w-planner.co");
    expect(url).toBeTruthy();
    const u = new URL(url);
    expect(u.searchParams.get("app")).toBe("w-planner");
    const ts = u.searchParams.get("ts");
    const email = u.searchParams.get("email");
    expect(u.searchParams.get("sig")).toBe(firmaEsperada("w-planner", ts, email));
  });

  it("deriva la base del Hub del ORIGIN de HUB_WEBHOOK_URL (no el path del webhook)", () => {
    const u = new URL(construirUrlPortalHub("a@b.com"));
    expect(u.origin).toBe("https://panel.softatumedida.com");
    expect(u.pathname).toBe("/mi-suscripcion");
  });

  it("normaliza el email (trim + lowercase) en el param y en la firma", () => {
    const u = new URL(construirUrlPortalHub("  Jefe@W-Planner.CO  "));
    expect(u.searchParams.get("email")).toBe("jefe@w-planner.co");
    expect(u.searchParams.get("sig")).toBe(
      firmaEsperada("w-planner", u.searchParams.get("ts"), "jefe@w-planner.co"),
    );
  });

  it("el ts es reciente (estampado al construir)", () => {
    const antes = Date.now();
    const u = new URL(construirUrlPortalHub("a@b.com"));
    const despues = Date.now();
    const ts = Number(u.searchParams.get("ts"));
    expect(ts).toBeGreaterThanOrEqual(antes);
    expect(ts).toBeLessThanOrEqual(despues);
  });

  it("falta HUB_WEBHOOK_SECRET → null", () => {
    delete process.env.HUB_WEBHOOK_SECRET;
    expect(construirUrlPortalHub("a@b.com")).toBeNull();
  });

  it("falta HUB_WEBHOOK_URL → null", () => {
    delete process.env.HUB_WEBHOOK_URL;
    expect(construirUrlPortalHub("a@b.com")).toBeNull();
  });

  it("HUB_WEBHOOK_URL inválida → null (no lanza)", () => {
    process.env.HUB_WEBHOOK_URL = "no-es-url";
    expect(construirUrlPortalHub("a@b.com")).toBeNull();
  });

  it("email vacío → null", () => {
    expect(construirUrlPortalHub("   ")).toBeNull();
  });
});
