import { AlertNotificationItem, TrackedOffer } from "./types";

function sanitizeMetaTemplateParam(text: string, maxLen = 180): string {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLen);
}

function parseWhatsAppRecipients(rawNumbers?: string): string[] {
  if (!rawNumbers) return [];
  return rawNumbers
    .split(",")
    .map((n) => n.replace(/\D/g, ""))
    .filter((n) => n.length >= 10);
}

export interface WhatsAppDispatchReport {
  configured: boolean;
  recipientsCount: number;
  sentCount: number;
  errors: string[];
  templateName: string;
}

/**
 * Envía la notificación a través de la API oficial de Meta WhatsApp Cloud
 * reutilizando la plantilla configurada en el bot de Montoc (`alerta_stock_montoc`),
 * la cual recibe 3 parámetros de texto en el cuerpo: ({{1}} aviso, {{2}} link, {{3}} conteo/intento).
 */
export async function sendMetaWhatsAppTemplate(params: {
  summaryText: string;
  linkUrl: string;
  attemptOrCount: string;
}): Promise<WhatsAppDispatchReport> {
  const token = process.env.WA_TOKEN;
  const phoneId = process.env.WA_PHONE_ID;
  const recipients = parseWhatsAppRecipients(process.env.MI_NUMERO);
  const templateName = process.env.TEMPLATE_NAME || "alerta_stock_montoc";
  const templateLang = process.env.TEMPLATE_LANG || "es_CO";

  if (!token || !phoneId || recipients.length === 0) {
    return {
      configured: false,
      recipientsCount: recipients.length,
      sentCount: 0,
      errors: [
        "Faltan variables de entorno: WA_TOKEN, WA_PHONE_ID o MI_NUMERO.",
      ],
      templateName,
    };
  }

  const param1 = sanitizeMetaTemplateParam(params.summaryText, 220);
  const param2 = sanitizeMetaTemplateParam(params.linkUrl, 200);
  const param3 = sanitizeMetaTemplateParam(params.attemptOrCount, 20);

  const endpoint = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
  let sentCount = 0;
  const errors: string[] = [];

  await Promise.all(
    recipients.map(async (toNumber) => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: toNumber,
            type: "template",
            template: {
              name: templateName,
              language: { code: templateLang },
              components: [
                {
                  type: "body",
                  parameters: [
                    { type: "text", text: param1 },
                    { type: "text", text: param2 },
                    { type: "text", text: param3 },
                  ],
                },
              ],
            },
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (res.ok) {
          sentCount += 1;
        } else {
          const errBody = await res.text().catch(() => "");
          errors.push(
            `Meta API ${res.status} para ${toNumber.slice(-4)}: ${errBody.slice(
              0,
              180
            )}`
          );
        }
      } catch (err) {
        errors.push(
          `Red hacia Meta para ${toNumber.slice(-4)}: ${
            err instanceof Error ? err.message : "Error desconocido"
          }`
        );
      }
    })
  );

  return {
    configured: true,
    recipientsCount: recipients.length,
    sentCount,
    errors,
    templateName,
  };
}

const MIN_REAL_SAVINGS_COP_FOR_ALERT = 300000; // Rebaja real mínima de $300.000 COP para disparar alerta

/**
 * Filtra únicamente ofertas reales consultadas EN VIVO que ameritan enviar aviso
 * por WhatsApp (evitando falsas alarmas por precios fijos de referencia).
 */
export function detectTriggerableAlerts(
  offers: TrackedOffer[]
): AlertNotificationItem[] {
  const alerts: AlertNotificationItem[] = [];
  const nowIso = new Date().toISOString();
  const liveOffers = offers.filter((o) => o.isLiveScraped);

  // 1. Mejor precio en vivo de la Galaxy Tab S10 FE+ (12GB / 256GB - Objetivo Exacto)
  const exactTablets = liveOffers
    .filter((o) => o.category === "tablet" && o.tabletSpecs?.isExactTarget)
    .sort((a, b) => a.priceAllMethods - b.priceAllMethods);

  if (exactTablets.length > 0) {
    const bestTab = exactTablets[0];
    if (
      bestTab.realSavingsCop >= MIN_REAL_SAVINGS_COP_FOR_ALERT &&
      (bestTab.authenticity === "verified_real_deal" ||
        bestTab.priceAllMethods <= 2899900)
    ) {
      alerts.push({
        id: `alert-tab-${bestTab.id}`,
        createdAt: nowIso,
        type: "tablet_drop",
        title: `🎯 Rebaja Real: Galaxy Tab S10 FE+ (12GB/256GB)`,
        message: `${bestTab.storeName} la tiene en vivo a $${bestTab.priceAllMethods.toLocaleString(
          "es-CO"
        )} (Todo medio de pago). Ahorro real: $${bestTab.realSavingsCop.toLocaleString(
          "es-CO"
        )} (-${bestTab.realDiscountPct}% real).`,
        offerId: bestTab.id,
        storeName: bestTab.storeName,
        priceAllMethods: bestTab.priceAllMethods,
        realDiscountPct: bestTab.realDiscountPct,
        url: bestTab.url,
      });
    }
  }

  // 2. Portátiles en "Caza Mayor" en vivo (Equipos de 3.25M+ que cayeron a <= 2.95M con rebaja >= $300.000)
  const cazaMayorLaptops = liveOffers
    .filter(
      (o) =>
        o.category === "laptop" &&
        o.authenticity === "caza_mayor" &&
        o.priceAllMethods <= 2950000 &&
        o.realSavingsCop >= MIN_REAL_SAVINGS_COP_FOR_ALERT
    )
    .sort(
      (a, b) =>
        (b.laptopSpecs?.hardwareScore || 0) -
        (a.laptopSpecs?.hardwareScore || 0)
    );

  for (const lap of cazaMayorLaptops.slice(0, 2)) {
    alerts.push({
      id: `alert-caza-${lap.id}`,
      createdAt: nowIso,
      type: "laptop_caza_mayor",
      title: `🚨 CAZA MAYOR: ${lap.brand} ${lap.laptopSpecs?.cpuModel}`,
      message: `Portátil gama superior (base ~$${lap.historicalBaselinePrice.toLocaleString(
        "es-CO"
      )}) bajó en vivo a $${lap.priceAllMethods.toLocaleString("es-CO")} en ${
        lap.storeName
      } (-${lap.realDiscountPct}% real).`,
      offerId: lap.id,
      storeName: lap.storeName,
      priceAllMethods: lap.priceAllMethods,
      realDiscountPct: lap.realDiscountPct,
      url: lap.url,
    });
  }

  // 3. Portátiles en rango ($2.3M - $2.95M) en vivo con rebaja real >= $300.000 COP y Score >= 82
  const realDealLaptops = liveOffers
    .filter(
      (o) =>
        o.category === "laptop" &&
        o.authenticity === "verified_real_deal" &&
        o.realSavingsCop >= MIN_REAL_SAVINGS_COP_FOR_ALERT &&
        o.priceAllMethods <= 2950000 &&
        (o.laptopSpecs?.hardwareScore || 0) >= 82
    )
    .sort((a, b) => b.realSavingsCop - a.realSavingsCop);

  for (const lap of realDealLaptops.slice(0, 2)) {
    alerts.push({
      id: `alert-deal-${lap.id}`,
      createdAt: nowIso,
      type: "laptop_real_deal",
      title: `✅ Oferta Real Portátil: ${lap.title.slice(0, 52)}`,
      message: `Bajó en vivo a $${lap.priceAllMethods.toLocaleString(
        "es-CO"
      )} en ${lap.storeName} (-${lap.realDiscountPct}% real). ${
        lap.laptopSpecs?.minecraftPerformance
      }.`,
      offerId: lap.id,
      storeName: lap.storeName,
      priceAllMethods: lap.priceAllMethods,
      realDiscountPct: lap.realDiscountPct,
      url: lap.url,
    });
  }

  return alerts;
}

/**
 * Despacha un único aviso consolidado a WhatsApp (vía Meta Cloud API con la
 * plantilla reutilizada) apuntando directo al dashboard web cuando haya alertas nuevas.
 */
export async function dispatchAlertNotifications(
  alerts: AlertNotificationItem[],
  dashboardUrl?: string
): Promise<{
  sentCount: number;
  channelsUsed: string[];
  formattedPreview: string;
  whatsappReport?: WhatsAppDispatchReport;
}> {
  if (alerts.length === 0) {
    return {
      sentCount: 0,
      channelsUsed: [],
      formattedPreview:
        "Sin alertas nuevas que notificar (precios sin cambios o ya avisados previamente).",
    };
  }

  const lines = [
    `🔥 *RADAR BLACK FRIDAY COLOMBIA (${new Date().toLocaleTimeString(
      "es-CO",
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    )})*`,
    `Se detectaron ${alerts.length} ofertas REALES nuevas (Todo medio de pago):`,
    "",
    ...alerts.map(
      (a, idx) =>
        `${idx + 1}. *${a.title}*\n   💰 Precio: *$${a.priceAllMethods.toLocaleString(
          "es-CO"
        )} COP* (-${a.realDiscountPct}% real)\n   🏬 Tienda: ${
          a.storeName
        }\n   📝 ${a.message}\n   🔗 ${a.url}`
    ),
  ];

  const formattedPreview = lines.join("\n");
  const channelsUsed: string[] = [];

  // 1. Envío oficial por Meta WhatsApp Cloud API (reutilizando plantilla alerta_stock_montoc)
  const top = alerts[0];
  const targetPageUrl =
    process.env.PUBLIC_DASHBOARD_URL || dashboardUrl || top.url;

  const shortWhatsAppSummary =
    alerts.length === 1
      ? `Radar BF: ${top.title} a $${top.priceAllMethods.toLocaleString(
          "es-CO"
        )} en ${top.storeName} (-${top.realDiscountPct}% real). Revisa el detalle en la pagina`
      : `Radar BF: ${
          alerts.length
        } ofertas reales nuevas! Destacada: ${top.title} a $${top.priceAllMethods.toLocaleString(
          "es-CO"
        )} en ${top.storeName}. Entra a la web para ver todas`;

  const whatsappReport = await sendMetaWhatsAppTemplate({
    summaryText: shortWhatsAppSummary,
    linkUrl: targetPageUrl,
    attemptOrCount: String(alerts.length),
  });

  if (whatsappReport.sentCount > 0) {
    channelsUsed.push("WhatsApp (Meta API)");
  }

  return {
    sentCount: whatsappReport.sentCount,
    channelsUsed,
    formattedPreview,
    whatsappReport,
  };
}
