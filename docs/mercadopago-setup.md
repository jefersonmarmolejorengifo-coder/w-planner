# Setup Mercado Pago — Sistema premium

Guía paso a paso para activar las suscripciones recurrentes después de aplicar la migración 016.

## 1. Cuenta y credenciales

1. Crea o entra a tu cuenta de Mercado Pago **vendedor** en https://www.mercadopago.com.co (o el país relevante).
2. Ve a https://www.mercadopago.com.co/developers/panel/app y crea una **aplicación**.
3. Copia el **Access Token de producción** (también puedes empezar con el de pruebas para validar).

## 2. Vercel — variables de entorno

En https://vercel.com/jefersonmarmolejorengifo-coders-projects/w-planner/settings/environment-variables agrega:

| Nombre | Valor | Ambientes |
|---|---|---|
| `MP_ACCESS_TOKEN` | el access token de tu app MP | Production + Preview + Development |
| `APP_BASE_URL` | `https://w-planner.vercel.app` | los 3 |

Espera el auto-deploy (~30 s) o forza uno desde el dashboard.

## 3. Configurar webhook en MP

En el panel de tu app MP → **Webhooks** → **Configurar notificaciones**:

- URL: `https://w-planner.vercel.app/api/mp-webhook`
- Modo: producción (o pruebas si estás validando)
- Eventos: marca al menos
  - **subscription_preapproval** (cambios de estado de la suscripción)
  - **subscription_authorized_payment** (cada cobro recurrente)

Guarda. MP enviará un ping de prueba — debe responder 200.

## 4. (Opcional) Crear planes en MP en lugar de definir auto_recurring inline

Por defecto, `mp-subscribe.js` define `auto_recurring` inline (precio + frecuencia) en cada suscripción. Si prefieres mantener planes editables desde MP:

1. Ve a **Suscripciones → Planes** en tu cuenta MP.
2. Crea un plan por cada tier (Pro Solo / Team / Power) con su precio en COP, frecuencia mensual.
3. Anota cada `preapproval_plan_id`.
4. Actualiza `tier_limits` en Supabase:
   ```sql
   UPDATE public.tier_limits SET mp_plan_id = '<id_del_plan>' WHERE tier = 'pro_solo';
   UPDATE public.tier_limits SET mp_plan_id = '<id_del_plan>' WHERE tier = 'pro_team';
   UPDATE public.tier_limits SET mp_plan_id = '<id_del_plan>' WHERE tier = 'pro_power';
   ```

El endpoint `mp-subscribe` detectará el `mp_plan_id` y lo usará en lugar del `auto_recurring` inline. Ventaja: si después subes precios, los actualizas en MP sin redeploy.

## 5. Flujo end-to-end

1. Usuario va a **Configuración del proyecto** → ve el card "Plan Gratis" con botones de upgrade.
2. Hace click en **Pro Solo / Team / Power**.
3. Frontend llama `POST /api/mp-subscribe { tier }`.
4. Endpoint crea preapproval en MP, marca `users_premium.status = 'pending'`, devuelve `init_point`.
5. Frontend redirige al usuario a `init_point` (URL de MP).
6. Usuario paga en MP.
7. MP llama al webhook `/api/mp-webhook` con `type=subscription_preapproval` → actualiza `users_premium.tier = 'pro_*'`, `status = 'active'`.
8. Usuario vuelve a la app (back_url) y ya ve su plan activo.
9. Por cada cobro mensual, MP envía `subscription_authorized_payment` → webhook actualiza `last_payment_at`.

## 6. Activar IA en un proyecto

Una vez el usuario tiene plan Pro activo:

1. Va a **Configuración** del proyecto donde quiere usar IA.
2. En el card "IA en este proyecto" hace click en **Activar IA**.
3. Si tiene capacidad disponible, queda activa y los reportes IA se pueden disparar (botón manual o cron).
4. Si llegó al límite del tier, el botón muestra "Sin capacidad" con explicación.

## 7. Endpoints que respetan el gating

Estos 3 endpoints verifican `user_can_use_ia_on_project` antes de gastar tokens:

- `POST /api/generate-report`        (Reporte Semanal PO — Opus 4.7)
- `POST /api/generate-scrum-report`  (Reporte Scrum bi-días — Gemini Flash)
- `POST /api/generate-monthly-report` (Reporte Mensual Equipo — Sonnet 4.6)

Si la verificación falla, devuelven 402 con mensaje explicativo.

## 8. Test rápido (en modo pruebas MP)

1. En MP, usa el access token de **TEST**.
2. En el dashboard de MP encuentra un **comprador de prueba** con su email + tarjeta de prueba.
3. Login en w-planner con ese email.
4. Configuración → suscribirse a Pro Solo.
5. Paga con la tarjeta de prueba.
6. Verifica:
   ```sql
   SELECT * FROM users_premium WHERE user_id = '<uuid>';
   -- tier='pro_solo', status='active', mp_preapproval_id rellenado.
   ```

## 9. Edge cases conocidos

- **`back_url` requiere HTTPS y dominio público.** Localhost no funciona. Para test usa el deploy de Vercel directamente.
- **MP a veces envía solo el `data.id` en query params** (no en body JSON). El webhook soporta ambos.
- **Si el usuario cancela desde MP** (no desde la app), el webhook recibe `subscription_preapproval` con `status='cancelled'` y `users_premium.status` se actualiza. En la próxima visita ve el card "Plan Gratis" otra vez.
- **Para downgrade entre tiers**: cancela la suscripción actual y crea una nueva. MP no soporta swap directo de plan en preapprovals.

## 10. Monitoreo

```sql
-- Cuántos usuarios premium hoy
SELECT tier, status, count(*)
FROM users_premium
GROUP BY tier, status
ORDER BY tier, status;

-- Cobros del último mes
SELECT date_trunc('day', last_payment_at) AS dia, count(*)
FROM users_premium
WHERE last_payment_at > NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1;
```
