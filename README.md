# Radar Anti-Precios Inflados Black Friday Colombia (Tablet & Portátil)

Aplicación web construida en **Next.js + TypeScript + Tailwind CSS**, conectada a la **API oficial de Meta WhatsApp Cloud** (reutilizando la plantilla `alerta_stock_montoc`), con persistencia histórica en **Upstash Redis** (en Vercel) o archivo local `.data/history.json`.

---

## 1. Cómo Subir a Vercel (Paso a Paso)

### Opción A — Directo por terminal (la más rápida)
1. En la carpeta del proyecto ejecuta:
   ```bash
   npx vercel
   ```
   Inicia sesión en tu navegador cuando te lo pida y presiona **Enter** a las preguntas por defecto.
2. Publica en producción:
   ```bash
   npx vercel --prod
   ```
3. Copia tus variables de `.env.local` al proyecto en Vercel (**Settings → Environment Variables**):
   - `WA_TOKEN`, `WA_PHONE_ID`, `WABA_ID`, `MI_NUMERO`, `TEMPLATE_NAME`, `TEMPLATE_LANG`
   - `PUBLIC_DASHBOARD_URL` = la URL que te dio Vercel (ej. `https://tu-app.vercel.app`)
4. En Vercel ve a **Storage → Browse Marketplace → Upstash Redis (Plan Gratis) → Connect to Project** (Vercel inyectará `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` automáticamente).
5. Haz un último `npx vercel --prod` (o **Redeploy** desde el panel de Vercel) para que tome las variables y Redis.

---

## 2. Cómo Configurar el Cron Gratuito (Cada 2 Horas)

1. Crea una cuenta gratuita en **`cron-job.org`** (o **`Checkly`** si quieres que haga clic en un botón).
2. En **`cron-job.org`**:
   - URL: `https://tu-app.vercel.app/api/actualizar?group=all&notify=true`
   - Programación: cada **2 horas** (`0 */2 * * *`).
3. Si prefieres un automatizador que presione el botón directamente en la página:
   - Selector CSS del botón: `#btn-actualizar-precios`
   - O abre la URL con auto-disparo: `https://tu-app.vercel.app/?auto=true`
