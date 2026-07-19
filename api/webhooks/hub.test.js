// api/webhooks/hub.test.js
//
// Tests del receptor del cable Hub→w-planner (api/webhooks/hub.js).
//
// ESTRATEGIA DE MOCK:
//   El handler importa createAdminClient de "../_supabase.js". En cada test
//   controlamos qué devuelve el admin client para simular los distintos caminos
//   del flujo sin tocar Supabase real.
//
//   Usamos `vi.mock` para interceptar el módulo. El mock devuelve un admin client
//   con un spy `from()` que encadenamos al estilo Supabase (builder pattern).
//
// LECTURA DEL RAW BODY:
//   El handler lee el raw body desde el stream (req.on('data'/'end')). Los tests
//   simulan un req con readable=true y emiten los chunks en la siguiente tick
//   usando process.nextTick, igual que haría Node.js con un stream real.
//
// MOCK DE RPC:
//   admin.rpc() ahora discrimina por nombre de función:
//     - 'hub_reclamar_evento'         → rpcClaims (configurable por test)
//     - 'get_user_id_by_email'        → rpcUserId
//     - 'hub_marcar_evento_procesado' → siempre éxito (salvo override)
//     - 'hub_revertir_evento'         → siempre éxito (salvo override)
//   Cada test configura solo lo que necesita cambiar del default.
//
// COBERTURA (14 casos):
//   Heredados (ajustados al nuevo mecanismo de reclamo):
//   1.  Evento válido → upsert users_premium ejecutado.
//   2.  x-hub-version malo → 400.
//   3.  Firma inválida → 401.
//   4.  Timestamp vencido → 401.
//   5.  app_slug distinto → 401.
//   6a. Duplicado (hub_reclamar_evento devuelve 'duplicate') → 200 sin upsert.
//   6b. In-flight (hub_reclamar_evento devuelve 'in_flight') → 200 sin upsert.
//   7.  Evento no manejado → 200 skipped.
//   8.  Email no resuelve → parqueado 200.
//   9.  Plan desconocido → parqueado 200.
//   10. Fallo del upsert → llama hub_revertir_evento → 500.
//   Nuevos (self-healing y estados del candado):
//   11. Fallo del upsert + fallo de hub_revertir_evento → igual responde 500.
//   12. hub_reclamar_evento devuelve error → 500 sin tocar users_premium.
//   13. Éxito → llama hub_marcar_evento_procesado antes de 200.
//   14. Payload de parqueo no contiene cliente_email en el JSONB (FIX A-2).

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

// ── Helpers para construir requests y responses de prueba ─────────────────────

const SECRET = "test_hub_secret_xyz";
const APP_SLUG = "w-planner";
const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440000";

/**
 * Construye los headers del protocolo X-Hub-Version: 1 con firma válida.
 *
 * @param {string} rawBody  JSON que se enviará como body
 * @param {object} overrides  Permite sobreescribir headers individuales
 * @param {object} opts
 * @param {string} [opts.secret=SECRET]   Secreto HMAC a usar
 * @param {string} [opts.slug=APP_SLUG]   X-App-Slug a usar en la firma
 * @param {number} [opts.tsDelta=0]       Desplazamiento en segundos del timestamp
 */
function buildHeaders(rawBody, overrides = {}, opts = {}) {
  const secret = opts.secret ?? SECRET;
  const slug   = opts.slug   ?? APP_SLUG;
  const ts     = Math.floor(Date.now() / 1000) + (opts.tsDelta ?? 0);
  const tsStr  = String(ts);

  const mensaje = `${slug}.${tsStr}.${rawBody}`;
  const sig = crypto.createHmac("sha256", secret).update(mensaje).digest("hex");

  return {
    "x-hub-version": "1",
    "x-app-slug":    APP_SLUG,
    "x-timestamp":   tsStr,
    "x-signature":   sig,
    ...overrides,
  };
}

/**
 * Construye un payload mínimo válido para el evento suscripcion.cobrada.
 */
function buildPayload(overrides = {}) {
  return {
    evento:         "suscripcion.cobrada",
    evento_id:      "sus-abc123:2026-07-01",
    app_slug:       "w-planner",
    cliente_email:  "jeferson@gmail.com",
    plan_codigo:    "pro",
    plan_nombre:    "Pro Solo",
    periodicidad:   "mensual",
    monto_cop:      30000,
    periodo:        "2026-07-01",
    proximo_cobro:  "2026-08-01T00:00:00Z",
    estado:         "activa",
    fecha:          "2026-07-01T12:00:00Z",
    ...overrides,
  };
}

/**
 * Crea un req mock que emite un body como stream, simulando Node.js HTTP.
 * El body se emite en la siguiente tick para que el handler pueda registrar
 * los listeners primero (igual que un stream real).
 *
 * @param {string} rawBody   String a emitir como chunk
 * @param {object} headers   Headers del request
 * @param {string} [method]  Método HTTP (default POST)
 */
function makeReq(rawBody, headers = {}, method = "POST") {
  const emitter = new EventEmitter();
  // readable=true → el handler leerá el stream (ruta principal).
  emitter.readable = true;
  emitter.method = method;
  emitter.headers = headers;

  // Emitir los datos en el siguiente tick para que el handler se suscriba primero.
  process.nextTick(() => {
    emitter.emit("data", Buffer.from(rawBody, "utf8"));
    emitter.emit("end");
  });

  return emitter;
}

/**
 * Crea un res mock que captura status y json para afirmaciones.
 */
function makeRes() {
  const res = {
    _status: null,
    _body:   null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

// ── Mock de Supabase ──────────────────────────────────────────────────────────
//
// Mockeamos createAdminClient para controlar las respuestas de BD en cada test.
//
// Cambio respecto al diseño anterior: admin.rpc() ahora discrimina por nombre
// de función. La función `hub_reclamar_evento` devuelve un string ('claimed',
// 'duplicate', 'in_flight') en lugar del UUID de usuario. Cada RPC tiene su
// propia configuración independiente.
//
// El builder de Supabase es: admin.from(table).insert(data).select(col)
//   → devuelve Promise<{ data, error }>
// También: admin.rpc(fn, args) → Promise<{ data, error }>
// Y: admin.from(table).upsert(data, opts) → Promise<{ error }>

/**
 * Construye un admin client mock con respuestas configurables por tabla y RPC.
 *
 * @param {object} tableConfig   Mapa tabla → función(op, selectCol) | objeto { data, error }
 * @param {object} rpcConfig     Mapa nombre_rpc → { data, error }
 *   Defaults para RPCs no configuradas:
 *     hub_reclamar_evento         → { data: 'claimed', error: null }
 *     get_user_id_by_email        → { data: VALID_USER_ID, error: null }
 *     hub_marcar_evento_procesado → { data: null, error: null }
 *     hub_revertir_evento         → { data: null, error: null }
 */
function makeAdminMock(tableConfig = {}, rpcConfig = {}) {
  // Defaults razonables para el camino feliz.
  const rpcDefaults = {
    hub_reclamar_evento:         { data: "claimed", error: null },
    get_user_id_by_email:        { data: VALID_USER_ID, error: null },
    hub_marcar_evento_procesado: { data: null, error: null },
    hub_revertir_evento:         { data: null, error: null },
  };

  // rpcConfig sobrescribe los defaults; el resto usa el default.
  const rpcResponses = { ...rpcDefaults, ...rpcConfig };

  // Registramos las llamadas para afirmar en los tests.
  const calls = {
    inserts:  [],  // [{ table, data }]
    deletes:  [],  // [{ table, eq }]
    upserts:  [],  // [{ table, data, opts }]
    rpc:      [],  // [{ fn, args }]
  };

  const buildChain = (table) => {
    // Estado interno del chain: acumula la operación hasta que el caller awaits.
    let _op = null;
    let _selectCol = null;

    const chain = {
      insert(data) {
        _op = "insert";
        calls.inserts.push({ table, data });
        return chain;
      },
      upsert(data, opts) {
        _op = "upsert";
        calls.upserts.push({ table, data, opts });
        return chain;
      },
      delete() {
        _op = "delete";
        return chain;
      },
      update(data) {
        _op = "update";
        calls.inserts.push({ table, op: "update", data });
        return chain;
      },
      select(col) {
        _selectCol = col;
        return chain;
      },
      // maybeSingle/single: no cambian la resolución (el `then` de abajo ya
      // resuelve según tableConfig[table]); solo necesitan existir como
      // métodos encadenables porque handlePagoReembolsado los usa tras
      // .select().eq() para leer una sola fila de users_premium.
      maybeSingle() {
        return chain;
      },
      single() {
        return chain;
      },
      eq(col, val) {
        if (_op === "delete") {
          calls.deletes.push({ table, col, val });
        }
        return chain;
      },
      // Cuando se awaita el chain, se resuelve con la respuesta configurada.
      then(resolve, reject) {
        const cfg = tableConfig[table];
        let result;
        if (cfg) {
          result = typeof cfg === "function" ? cfg(_op, _selectCol) : cfg;
        } else {
          // Default: éxito con data vacío.
          result = { data: [], error: null };
        }
        // Si es una Promise, esperarla; si no, resolver directo.
        if (result && typeof result.then === "function") {
          result.then(resolve, reject);
        } else {
          resolve(result);
        }
      },
    };
    return chain;
  };

  const admin = {
    calls,
    from(table) {
      return buildChain(table);
    },
    async rpc(fn, args) {
      calls.rpc.push({ fn, args });
      // Discriminar por nombre de función.
      const resp = rpcResponses[fn];
      if (resp !== undefined) {
        return typeof resp === "function" ? resp(args) : resp;
      }
      // Función no configurada y sin default → simular error claro.
      return { data: null, error: { message: `rpc '${fn}' no mockeada` } };
    },
  };

  return admin;
}

// ── Mock del módulo _supabase.js ──────────────────────────────────────────────
// Declaramos la variable del admin a nivel de módulo para poder cambiarla
// entre tests.
let _mockAdmin = null;

vi.mock("../_supabase.js", () => ({
  createAdminClient: () => _mockAdmin,
}));

// ── Importar el handler DESPUÉS del mock ─────────────────────────────────────
// Importante: el import debe ser después de vi.mock() para que Vitest
// intercepte el módulo antes de que hub.js lo importe.
const { default: handler } = await import("./hub.js");

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("hub.js — receptor cable Hub→w-planner", () => {
  beforeEach(() => {
    // Restaurar variables de entorno antes de cada test.
    process.env.HUB_WEBHOOK_SECRET = SECRET;
    // Reset del admin mock (se sobreescribe en cada test que lo necesita).
    _mockAdmin = null;
  });

  // ── Test 1: Evento válido activa users_premium ──────────────────────────────
  it("(1) evento válido → upsert users_premium con tier correcto", async () => {
    const payload = buildPayload();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    // Camino feliz: hub_reclamar_evento → 'claimed' (default),
    // get_user_id_by_email → VALID_USER_ID (default), upsert → éxito.
    _mockAdmin = makeAdminMock({
      users_premium: { data: null, error: null },
    });

    const req = makeReq(rawBody, headers);
    const res = makeRes();

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true });

    // Verificar que se llamó hub_reclamar_evento.
    const reclamoCall = _mockAdmin.calls.rpc.find((c) => c.fn === "hub_reclamar_evento");
    expect(reclamoCall).toBeDefined();
    expect(reclamoCall.args.p_evento_id).toBe(payload.evento_id);

    // Verificar que se intentó el upsert de users_premium.
    const upsert = _mockAdmin.calls.upserts.find((u) => u.table === "users_premium");
    expect(upsert).toBeDefined();
    expect(upsert.data.tier).toBe("pro_solo");     // "pro" → "pro_solo"
    expect(upsert.data.status).toBe("active");
    expect(upsert.data.user_id).toBe(VALID_USER_ID);
    expect(upsert.data.metadata.provider).toBe("wompi-hub");
    expect(upsert.data.metadata.hub_evento_id).toBe(payload.evento_id);

    // Verificar que se llamó hub_marcar_evento_procesado (FIX A-1).
    const markCall = _mockAdmin.calls.rpc.find((c) => c.fn === "hub_marcar_evento_procesado");
    expect(markCall).toBeDefined();
    expect(markCall.args.p_evento_id).toBe(payload.evento_id);
  });

  // ── Test 2: x-hub-version malo → 400 ───────────────────────────────────────
  it("(2) x-hub-version distinto de '1' → 400", async () => {
    const payload = buildPayload();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody, { "x-hub-version": "2" });

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/unsupported_protocol_version/);
  });

  // ── Test 3: Firma inválida → 401 ────────────────────────────────────────────
  it("(3) firma HMAC inválida → 401", async () => {
    const payload = buildPayload();
    const rawBody = JSON.stringify(payload);
    // Firma calculada con secreto incorrecto.
    const headers = buildHeaders(rawBody, {}, { secret: "secreto_incorrecto" });

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(401);
    expect(res._body.error).toMatch(/invalid_signature/);
  });

  // ── Test 4: Timestamp vencido → 401 ─────────────────────────────────────────
  it("(4) timestamp fuera de ventana ±5 min → 401", async () => {
    const payload = buildPayload();
    const rawBody = JSON.stringify(payload);
    // tsDelta: -400 segundos = hace más de 5 minutos.
    const headers = buildHeaders(rawBody, {}, { tsDelta: -400 });

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(401);
    expect(res._body.error).toMatch(/timestamp_out_of_window/);
  });

  // ── Test 5: app_slug distinto en payload → 401 ──────────────────────────────
  it("(5) payload.app_slug !== 'w-planner' → 401", async () => {
    // El payload declara otro app_slug.
    const payload = buildPayload({ app_slug: "voxlab" });
    const rawBody = JSON.stringify(payload);
    // Firma correcta (header X-App-Slug es w-planner, el mensaje firmado usa w-planner).
    const headers = buildHeaders(rawBody);

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(401);
    expect(res._body.error).toBe("unauthorized");
  });

  // ── Test 6a: Duplicado → 200 sin upsert ──────────────────────────────────────
  // hub_reclamar_evento devuelve 'duplicate' = evento ya procesado exitosamente.
  it("(6a) hub_reclamar_evento 'duplicate' → 200 sin upsert", async () => {
    const payload = buildPayload();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    _mockAdmin = makeAdminMock(
      {},
      { hub_reclamar_evento: { data: "duplicate", error: null } },
    );

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, duplicate: true });

    // No debe haber upsert a users_premium.
    const upsert = _mockAdmin.calls.upserts.find((u) => u.table === "users_premium");
    expect(upsert).toBeUndefined();

    // No debe llamar hub_marcar_evento_procesado (ya estaba procesado).
    const markCall = _mockAdmin.calls.rpc.find((c) => c.fn === "hub_marcar_evento_procesado");
    expect(markCall).toBeUndefined();
  });

  // ── Test 6b: In-flight → 200 sin upsert ──────────────────────────────────────
  // hub_reclamar_evento devuelve 'in_flight' = otra corrida activa (<15 min) tiene el evento.
  it("(6b) hub_reclamar_evento 'in_flight' → 200 sin upsert (self-heal si muere)", async () => {
    const payload = buildPayload();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    _mockAdmin = makeAdminMock(
      {},
      { hub_reclamar_evento: { data: "in_flight", error: null } },
    );

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, in_flight: true });

    // No debe haber upsert a users_premium.
    const upsert = _mockAdmin.calls.upserts.find((u) => u.table === "users_premium");
    expect(upsert).toBeUndefined();

    // No debe llamar hub_revertir_evento (no hemos tomado el candado).
    const revertCall = _mockAdmin.calls.rpc.find((c) => c.fn === "hub_revertir_evento");
    expect(revertCall).toBeUndefined();
  });

  // ── Test 7: Evento no manejado → 200 skipped ────────────────────────────────
  it("(7) evento distinto de suscripcion.cobrada → 200 skipped (forward-compat)", async () => {
    const payload = buildPayload({ evento: "suscripcion.cancelada" });
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    // No necesita admin mock porque no llegamos a tocar BD.
    _mockAdmin = makeAdminMock({});

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, skipped: "evento_no_manejado" });
  });

  // ── Test 8: Email no resuelve → parqueado 200 ───────────────────────────────
  it("(8) email no encontrado en auth.users → parqueado en sin_resolver, 200", async () => {
    const payload = buildPayload({ cliente_email: "desconocido@ejemplo.com" });
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    // RPC get_user_id_by_email devuelve null (usuario no existe).
    // hub_reclamar_evento → 'claimed' (default).
    _mockAdmin = makeAdminMock(
      {
        hub_eventos_sin_resolver: { data: null, error: null },
      },
      { get_user_id_by_email: { data: null, error: null } },
    );

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, parked: "user_not_found" });

    // Verificar que se intentó el upsert en hub_eventos_sin_resolver.
    const parqueo = _mockAdmin.calls.upserts.find(
      (u) => u.table === "hub_eventos_sin_resolver",
    );
    expect(parqueo).toBeDefined();
    expect(parqueo.data.evento_id).toBe(payload.evento_id);
    expect(parqueo.data.cliente_email).toBe(payload.cliente_email);

    // FIX A-2: el JSONB payload NO debe contener cliente_email.
    expect(parqueo.data.payload).not.toHaveProperty("cliente_email");

    // Parqueo es terminal: debe marcar el evento procesado.
    const markCall = _mockAdmin.calls.rpc.find((c) => c.fn === "hub_marcar_evento_procesado");
    expect(markCall).toBeDefined();
  });

  // ── Test 9: Plan desconocido → parqueado 200 ────────────────────────────────
  it("(9) plan_codigo no está en el mapa → parqueado en sin_resolver, 200", async () => {
    const payload = buildPayload({ plan_codigo: "plan_fantasma" });
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    // RPC resuelve el usuario (encontrado), pero el plan no existe en el mapa.
    // hub_reclamar_evento → 'claimed' (default).
    // get_user_id_by_email → VALID_USER_ID (default).
    _mockAdmin = makeAdminMock({
      hub_eventos_sin_resolver: { data: null, error: null },
    });

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, parked: "plan_desconocido" });

    // Verificar que se parqueó con plan_codigo correcto.
    const parqueo = _mockAdmin.calls.upserts.find(
      (u) => u.table === "hub_eventos_sin_resolver",
    );
    expect(parqueo).toBeDefined();
    expect(parqueo.data.plan_codigo).toBe("plan_fantasma");

    // FIX A-2: el JSONB payload NO debe contener cliente_email.
    expect(parqueo.data.payload).not.toHaveProperty("cliente_email");

    // Parqueo es terminal: debe marcar el evento procesado.
    const markCall = _mockAdmin.calls.rpc.find((c) => c.fn === "hub_marcar_evento_procesado");
    expect(markCall).toBeDefined();
  });

  // ── Test 10: Fallo del upsert → hub_revertir_evento + 500 ───────────────────
  it("(10) error en upsert users_premium → hub_revertir_evento (reversión) + 500", async () => {
    const payload = buildPayload();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    // hub_reclamar_evento → 'claimed' (default).
    // get_user_id_by_email → VALID_USER_ID (default).
    // upsert users_premium → falla.
    // hub_revertir_evento → éxito (default).
    _mockAdmin = makeAdminMock({
      users_premium: {
        data:  null,
        error: { message: "connection timeout", code: "08006" },
      },
    });

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.error).toBeDefined();

    // Verificar que se llamó hub_revertir_evento (reemplaza el DELETE del diseño anterior).
    const revertCall = _mockAdmin.calls.rpc.find((c) => c.fn === "hub_revertir_evento");
    expect(revertCall).toBeDefined();
    expect(revertCall.args.p_evento_id).toBe(payload.evento_id);

    // Verificar que se intentó el upsert (y falló).
    const upsert = _mockAdmin.calls.upserts.find((u) => u.table === "users_premium");
    expect(upsert).toBeDefined();

    // NO debe llamar hub_marcar_evento_procesado en fallo.
    const markCall = _mockAdmin.calls.rpc.find((c) => c.fn === "hub_marcar_evento_procesado");
    expect(markCall).toBeUndefined();
  });

  // ── Test 11: Fallo upsert + fallo de reversión → igual 500 (self-heal) ───────
  // Cubre la propiedad self-healing principal del FIX A-1:
  // si hub_revertir_evento falla, el evento queda en 'procesando' con timestamp
  // viejo → a los 15 min la RPC lo auto-reclama en el próximo reintento del Hub.
  it("(11) upsert falla + hub_revertir_evento falla → 500 (self-heal a los 15 min)", async () => {
    const payload = buildPayload();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    // Configurar: upsert falla, reversión falla.
    _mockAdmin = makeAdminMock(
      {
        users_premium: {
          data:  null,
          error: { message: "connection timeout", code: "08006" },
        },
      },
      {
        // hub_reclamar_evento → 'claimed' (default).
        // get_user_id_by_email → VALID_USER_ID (default).
        hub_revertir_evento: { data: null, error: { message: "db unavailable" } },
      },
    );

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    // Debe responder 500 de todas formas (el Hub reintentará).
    expect(res._status).toBe(500);
    expect(res._body.error).toBeDefined();

    // Se intentó la reversión (aunque falló).
    const revertCall = _mockAdmin.calls.rpc.find((c) => c.fn === "hub_revertir_evento");
    expect(revertCall).toBeDefined();

    // El evento quedará en 'procesando' con timestamp viejo →
    // a los 15 min hub_reclamar_evento lo auto-reclama (self-healing).
    // Este test verifica que la respuesta 500 se emite aunque la reversión falle,
    // lo que garantiza que el Hub reintentará y activará el plan eventualmente.
  });

  // ── Test 12: hub_reclamar_evento error → 500 sin tocar users_premium ─────────
  it("(12) hub_reclamar_evento devuelve error → 500 sin ningún efecto en BD", async () => {
    const payload = buildPayload();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    _mockAdmin = makeAdminMock(
      {},
      { hub_reclamar_evento: { data: null, error: { message: "connection refused" } } },
    );

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.error).toMatch(/db_error/);

    // No debe haber upsert a users_premium.
    const upsert = _mockAdmin.calls.upserts.find((u) => u.table === "users_premium");
    expect(upsert).toBeUndefined();

    // No debe llamar hub_revertir_evento (nunca llegamos a reclamar nada).
    const revertCall = _mockAdmin.calls.rpc.find((c) => c.fn === "hub_revertir_evento");
    expect(revertCall).toBeUndefined();
  });

  // ── Test 13: Éxito → hub_marcar_evento_procesado antes de 200 ────────────────
  it("(13) éxito → hub_marcar_evento_procesado llamado antes de 200", async () => {
    const payload = buildPayload();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    const rpcOrder = [];
    _mockAdmin = makeAdminMock(
      {
        users_premium: { data: null, error: null },
      },
      {
        hub_reclamar_evento:         { data: "claimed", error: null },
        get_user_id_by_email:        { data: VALID_USER_ID, error: null },
        hub_marcar_evento_procesado: (args) => {
          rpcOrder.push("marked");
          return { data: null, error: null };
        },
      },
    );

    // Interceptar el res.json para capturar cuándo se responde.
    const res = makeRes();
    const origJson = res.json.bind(res);
    res.json = function(body) {
      rpcOrder.push("responded");
      return origJson(body);
    };

    const req = makeReq(rawBody, headers);
    await handler(req, res);

    expect(res._status).toBe(200);

    // El marcado debe ocurrir ANTES de la respuesta 200.
    expect(rpcOrder[0]).toBe("marked");
    expect(rpcOrder[1]).toBe("responded");
  });

  // ── Test 14: FIX A-2 — payload de parqueo sin cliente_email en el JSONB ───────
  it("(14) parqueo: el JSONB payload no contiene cliente_email (mínima PII)", async () => {
    const email = "usuario.especial+test@mi-empresa.com";
    const payload = buildPayload({ cliente_email: email, plan_codigo: "plan_inexistente" });
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    _mockAdmin = makeAdminMock({
      hub_eventos_sin_resolver: { data: null, error: null },
    });

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, parked: "plan_desconocido" });

    const parqueo = _mockAdmin.calls.upserts.find(
      (u) => u.table === "hub_eventos_sin_resolver",
    );
    expect(parqueo).toBeDefined();

    // El email vive SOLO en la columna dedicada, NO en el JSONB.
    expect(parqueo.data.cliente_email).toBe(email);
    expect(parqueo.data.payload.cliente_email).toBeUndefined();

    // El resto del payload sí está presente en el JSONB.
    expect(parqueo.data.payload.evento_id).toBe(payload.evento_id);
    expect(parqueo.data.payload.plan_codigo).toBe("plan_inexistente");
    expect(parqueo.data.payload.monto_cop).toBe(30000);
  });

  // ── Tests adicionales de bajo coste (robustez de la spec) ──────────────────

  it("(bonus) secreto HUB_WEBHOOK_SECRET ausente → 503 fail-closed", async () => {
    const payload = buildPayload();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    delete process.env.HUB_WEBHOOK_SECRET;

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(503);
    expect(res._body.error).toMatch(/webhook_secret_not_configured/);
  });

  it("(bonus) método GET → 405", async () => {
    const req = makeReq("", {}, "GET");
    const res = makeRes();
    await handler(req, res);
    expect(res._status).toBe(405);
  });

  it("(bonus) planes pro, proteam, propower mapean a tiers internos correctos", async () => {
    const casos = [
      { plan_codigo: "pro",       tier_esperado: "pro_solo"  },
      { plan_codigo: "proteam",   tier_esperado: "pro_team"  },
      { plan_codigo: "propower",  tier_esperado: "pro_power" },
    ];

    for (const caso of casos) {
      const payload = buildPayload({ plan_codigo: caso.plan_codigo });
      const rawBody = JSON.stringify(payload);
      const headers = buildHeaders(rawBody);

      // Reiniciar el mock para cada caso.
      _mockAdmin = makeAdminMock({
        users_premium: { data: null, error: null },
      });

      const req = makeReq(rawBody, headers);
      const res = makeRes();
      await handler(req, res);

      expect(res._status).toBe(200);
      const upsert = _mockAdmin.calls.upserts.find((u) => u.table === "users_premium");
      expect(upsert?.data?.tier).toBe(caso.tier_esperado);
    }
  });

  it("(bonus) current_period_end usa proximo_cobro del payload cuando viene", async () => {
    const payload = buildPayload({ proximo_cobro: "2026-08-15T00:00:00Z" });
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    _mockAdmin = makeAdminMock({
      users_premium: { data: null, error: null },
    });

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    const upsert = _mockAdmin.calls.upserts.find((u) => u.table === "users_premium");
    expect(upsert?.data?.current_period_end).toBe("2026-08-15T00:00:00Z");
  });

  it("(bonus) current_period_end es null cuando proximo_cobro no viene en payload", async () => {
    const payload = buildPayload({ proximo_cobro: undefined });
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    _mockAdmin = makeAdminMock({
      users_premium: { data: null, error: null },
    });

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    const upsert = _mockAdmin.calls.upserts.find((u) => u.table === "users_premium");
    expect(upsert?.data?.current_period_end).toBeNull();
  });
});

// ── Tests de pago.reembolsado ──────────────────────────────────────────────────
//
// CONTRATO: docs/eventos-salientes.md (softatumedida-panel) — el Hub emite este
// evento cuando un admin anula un cobro por reembolso. w-planner debe revocar
// el acceso (tier→'free', status→'cancelled') SOLO si el cobro reembolsado
// (evento_id_original) es el que otorgó el estado vigente de users_premium
// (comparado contra metadata.hub_evento_id, que handleSuscripcionCobrada ya
// escribe en cada cobro exitoso). Ver el JSDoc de handlePagoReembolsado en
// hub.js para el razonamiento completo (por qué no se usa el esquema
// wompi_pay:/wompi_sub: de la SPEC: w-planner no tiene ledger de pagos).
//
// COBERTURA (10 casos):
//   1. Camino feliz: evento_id_original coincide → revoca (tier=free, status=cancelled).
//   2. evento_id_original NO coincide con el acceso vigente → parqueado, sin tocar la fila.
//   3. Email no resuelve → parqueado (user_not_found).
//   4. Usuario sin fila en users_premium → nothing_to_revoke.
//   5. Ya estaba revocado (mismo evento) → already_revoked, sin UPDATE.
//   6. cliente_email ausente en el payload → parqueado.
//   7. evento_id_original ausente → 400.
//   8. periodicidad inválida → 400.
//   9. Candado 'duplicate'/'in_flight' → 200 sin tocar users_premium.
//   10. Fallo del UPDATE → hub_revertir_evento + 500.
describe("hub.js — pago.reembolsado (revocación de acceso)", () => {
  const EVENTO_ORIGINAL = "sus-abc123:2026-07-01";

  beforeEach(() => {
    process.env.HUB_WEBHOOK_SECRET = SECRET;
    _mockAdmin = null;
  });

  /** Payload mínimo válido para pago.reembolsado según la SPEC del Hub. */
  function buildPayloadReembolso(overrides = {}) {
    return {
      evento:             "pago.reembolsado",
      evento_id:          `refund:${EVENTO_ORIGINAL}`,
      app_slug:           "w-planner",
      cliente_email:      "jeferson@gmail.com",
      app_cliente_ref:    null,
      evento_id_original: EVENTO_ORIGINAL,
      periodicidad:       "mensual",
      concepto:           null,
      motivo:             "solicitud del cliente",
      fecha:              "2026-07-10T12:00:00Z",
      ...overrides,
    };
  }

  /**
   * Mock de la fila users_premium: distingue SELECT (op=null, sin .update()
   * previo en el chain) de UPDATE (op="update") para que el mismo tableConfig
   * sirva a ambas operaciones del handler.
   */
  function mockPremiumRow(row, { updateError = null, updateAffected = 1 } = {}) {
    return (op) => {
      if (op === "update") {
        // El UPDATE atómico del handler encadena .select("user_id") y cuenta
        // filas afectadas: updateAffected=0 simula la carrera TOCTOU (una
        // renovación cambió hub_evento_id entre el SELECT y el UPDATE).
        return {
          data: updateError ? null : Array.from({ length: updateAffected }, () => ({ user_id: "u-1" })),
          error: updateError,
        };
      }
      return { data: row, error: null };
    };
  }

  // ── Test 1: Camino feliz — revoca ───────────────────────────────────────────
  it("(1) evento_id_original coincide con el acceso vigente → revoca tier=free/status=cancelled", async () => {
    const payload = buildPayloadReembolso();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    _mockAdmin = makeAdminMock({
      users_premium: mockPremiumRow({
        tier: "pro_solo",
        status: "active",
        metadata: { provider: "wompi-hub", hub_evento_id: EVENTO_ORIGINAL },
      }),
    });

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, revoked: true });

    const update = _mockAdmin.calls.inserts.find(
      (c) => c.table === "users_premium" && c.op === "update",
    );
    expect(update).toBeDefined();
    expect(update.data.tier).toBe("free");
    expect(update.data.status).toBe("cancelled");
    // La metadata previa (provider) se preserva; se añade el rastro del reembolso.
    expect(update.data.metadata.provider).toBe("wompi-hub");
    expect(update.data.metadata.last_event).toBe("pago.reembolsado");
    expect(update.data.metadata.hub_refund_evento_id).toBe(payload.evento_id);
    expect(update.data.metadata.motivo_reembolso).toBe("solicitud del cliente");

    const markCall = _mockAdmin.calls.rpc.find((c) => c.fn === "hub_marcar_evento_procesado");
    expect(markCall).toBeDefined();
  });

  // ── Test 1b: Carrera TOCTOU — renovación entre SELECT y UPDATE ─────────────
  it("(1b) el UPDATE atómico afecta 0 filas (renovación concurrente pisó hub_evento_id) → parquea sin revocar", async () => {
    const payload = buildPayloadReembolso();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    // El SELECT del paso 3 aún ve el evento original como vigente (por eso el
    // handler avanza al paso 4), pero el UPDATE condicionado devuelve 0 filas:
    // una suscripcion.cobrada concurrente ya reemplazó hub_evento_id.
    _mockAdmin = makeAdminMock({
      users_premium: mockPremiumRow(
        {
          tier: "pro_solo",
          status: "active",
          metadata: { provider: "wompi-hub", hub_evento_id: EVENTO_ORIGINAL },
        },
        { updateAffected: 0 },
      ),
    });

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, parked: "evento_original_cambio_durante_reembolso" });

    // Se marcó procesado (no habrá reintentos que revoquen la renovación nueva).
    const markCall = _mockAdmin.calls.rpc.find((c) => c.fn === "hub_marcar_evento_procesado");
    expect(markCall).toBeDefined();
  });

  // ── Test 2: evento_id_original no coincide → parqueado, sin tocar la fila ────
  it("(2) el cobro reembolsado no otorgó el acceso vigente → parqueado sin UPDATE", async () => {
    const payload = buildPayloadReembolso();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    // La fila vigente fue otorgada por OTRO evento (ej. un cobro posterior).
    _mockAdmin = makeAdminMock({
      users_premium: mockPremiumRow({
        tier: "pro_solo",
        status: "active",
        metadata: { hub_evento_id: "sus-otro-evento:2026-08-01" },
      }),
      hub_eventos_sin_resolver: { data: null, error: null },
    });

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, parked: "evento_original_no_es_el_vigente" });

    const update = _mockAdmin.calls.inserts.find(
      (c) => c.table === "users_premium" && c.op === "update",
    );
    expect(update).toBeUndefined();

    const parqueo = _mockAdmin.calls.upserts.find((u) => u.table === "hub_eventos_sin_resolver");
    expect(parqueo).toBeDefined();
    expect(parqueo.data.payload).not.toHaveProperty("cliente_email");
  });

  // ── Test 3: Email no resuelve → parqueado ────────────────────────────────────
  it("(3) cliente_email no encontrado en auth.users → parqueado (user_not_found)", async () => {
    const payload = buildPayloadReembolso({ cliente_email: "fantasma@ejemplo.com" });
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    _mockAdmin = makeAdminMock(
      { hub_eventos_sin_resolver: { data: null, error: null } },
      { get_user_id_by_email: { data: null, error: null } },
    );

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, parked: "user_not_found" });
  });

  // ── Test 4: Usuario sin fila en users_premium → nothing_to_revoke ────────────
  it("(4) usuario sin fila en users_premium → nothing_to_revoke", async () => {
    const payload = buildPayloadReembolso();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    _mockAdmin = makeAdminMock({
      users_premium: { data: null, error: null }, // maybeSingle() sin filas
    });

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, nothing_to_revoke: true });

    const update = _mockAdmin.calls.inserts.find(
      (c) => c.table === "users_premium" && c.op === "update",
    );
    expect(update).toBeUndefined();
  });

  // ── Test 5: Ya estaba revocado → already_revoked, sin UPDATE ─────────────────
  it("(5) ya estaba revocado (mismo evento) → already_revoked, sin volver a actualizar", async () => {
    const payload = buildPayloadReembolso();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    _mockAdmin = makeAdminMock({
      users_premium: mockPremiumRow({
        tier: "free",
        status: "cancelled",
        metadata: { hub_evento_id: EVENTO_ORIGINAL, hub_refund_evento_id: payload.evento_id },
      }),
    });

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, already_revoked: true });

    const update = _mockAdmin.calls.inserts.find(
      (c) => c.table === "users_premium" && c.op === "update",
    );
    expect(update).toBeUndefined();
  });

  // ── Test 6: cliente_email ausente → parqueado ─────────────────────────────────
  it("(6) payload sin cliente_email → parqueado (cliente_email_ausente)", async () => {
    const payload = buildPayloadReembolso({ cliente_email: null });
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    _mockAdmin = makeAdminMock({ hub_eventos_sin_resolver: { data: null, error: null } });

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, parked: "cliente_email_ausente" });
  });

  // ── Test 7: evento_id_original ausente → 400 ─────────────────────────────────
  it("(7) payload sin evento_id_original → 400", async () => {
    const payload = buildPayloadReembolso({ evento_id_original: undefined });
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    _mockAdmin = makeAdminMock({});

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toBe("missing_evento_id_original");
  });

  // ── Test 8: periodicidad inválida → 400 ──────────────────────────────────────
  it("(8) periodicidad distinta de 'unico'/'mensual' → 400", async () => {
    const payload = buildPayloadReembolso({ periodicidad: "semanal" });
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    _mockAdmin = makeAdminMock({});

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toBe("invalid_periodicidad");
  });

  // ── Test 9: Candado duplicate/in_flight → 200 sin tocar users_premium ────────
  it("(9a) hub_reclamar_evento 'duplicate' → 200 sin tocar users_premium", async () => {
    const payload = buildPayloadReembolso();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    _mockAdmin = makeAdminMock(
      {},
      { hub_reclamar_evento: { data: "duplicate", error: null } },
    );

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, duplicate: true });

    const update = _mockAdmin.calls.inserts.find(
      (c) => c.table === "users_premium" && c.op === "update",
    );
    expect(update).toBeUndefined();
  });

  it("(9b) hub_reclamar_evento 'in_flight' → 200 sin tocar users_premium", async () => {
    const payload = buildPayloadReembolso();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    _mockAdmin = makeAdminMock(
      {},
      { hub_reclamar_evento: { data: "in_flight", error: null } },
    );

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true, in_flight: true });
  });

  // ── Test 10: Fallo del UPDATE → hub_revertir_evento + 500 ────────────────────
  it("(10) error en UPDATE users_premium → hub_revertir_evento + 500", async () => {
    const payload = buildPayloadReembolso();
    const rawBody = JSON.stringify(payload);
    const headers = buildHeaders(rawBody);

    _mockAdmin = makeAdminMock({
      users_premium: mockPremiumRow(
        {
          tier: "pro_solo",
          status: "active",
          metadata: { hub_evento_id: EVENTO_ORIGINAL },
        },
        { updateError: { message: "connection timeout", code: "08006" } },
      ),
    });

    const req = makeReq(rawBody, headers);
    const res = makeRes();
    await handler(req, res);

    expect(res._status).toBe(500);
    expect(res._body.error).toBeDefined();

    const revertCall = _mockAdmin.calls.rpc.find((c) => c.fn === "hub_revertir_evento");
    expect(revertCall).toBeDefined();
    expect(revertCall.args.p_evento_id).toBe(payload.evento_id);
  });
});
