import { NextRequest, NextResponse } from "next/server";
import {
  detectTriggerableAlerts,
  dispatchAlertNotifications,
  sendMetaWhatsAppTemplate,
} from "@/lib/alerts";
import { deduplicateOffers, runStoreGroupScraper } from "@/lib/scrapers";
import {
  getStorageBackendMode,
  persistScanAndDeduplicateAlerts,
} from "@/lib/storage";
import { TrackedOffer } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const group = request.nextUrl.searchParams.get("group") || "all";
  const notify = request.nextUrl.searchParams.get("notify") !== "false";
  const testWhatsapp = request.nextUrl.searchParams.get("testWhatsapp") === "1";
  const includeOffers =
    request.nextUrl.searchParams.get("includeOffers") === "1";
  const originUrl = request.nextUrl.origin;

  if (testWhatsapp) {
    const whatsappReport = await sendMetaWhatsAppTemplate({
      summaryText:
        "Prueba exitosa del Radar Black Friday Colombia: alertas WhatsApp activas",
      linkUrl: process.env.PUBLIC_DASHBOARD_URL || originUrl,
      attemptOrCount: "1",
    });

    return NextResponse.json({
      ok: whatsappReport.sentCount > 0,
      testWhatsapp: true,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      storageMode: getStorageBackendMode(),
      whatsappReport,
    });
  }

  try {
    const rawOffers = await runStoreGroupScraper(group);

    // Si se consulta un solo grupo (llamada parcial desde el botón de la web),
    // devolvemos rápido para no bloquear ni duplicar escrituras de estado.
    if (group !== "all") {
      return NextResponse.json({
        ok: true,
        group,
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        totalOffers: rawOffers.length,
        offers: rawOffers,
        storageMode: getStorageBackendMode(),
      });
    }

    // Ejecución completa (ej. desde cron-job.org cada 2 horas)
    const candidateAlerts = detectTriggerableAlerts(rawOffers);
    const persisted = await persistScanAndDeduplicateAlerts({
      offers: rawOffers,
      candidateAlerts,
      willDispatchWhatsApp: notify,
    });

    let notificationResult: Awaited<
      ReturnType<typeof dispatchAlertNotifications>
    > = {
      sentCount: 0,
      channelsUsed: [],
      formattedPreview: "",
    };

    if (notify) {
      notificationResult = await dispatchAlertNotifications(
        persisted.newAlertsToSend,
        originUrl
      );
    }

    const bestExactTablet = persisted.enrichedOffers
      .filter((o) => o.category === "tablet" && o.tabletSpecs?.isExactTarget)
      .sort((a, b) => a.priceAllMethods - b.priceAllMethods)[0];

    const bestLaptopInBudget = persisted.enrichedOffers
      .filter((o) => o.category === "laptop" && o.priceAllMethods <= 2950000)
      .sort(
        (a, b) =>
          (b.laptopSpecs?.hardwareScore || 0) -
          (a.laptopSpecs?.hardwareScore || 0)
      )[0];

    const compactSummary = {
      ok: true,
      group,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      storageMode: persisted.storageMode,
      persistedOk: persisted.persistedOk,
      totalOffers: persisted.enrichedOffers.length,
      liveOffersCount: persisted.enrichedOffers.filter((o) => o.isLiveScraped)
        .length,
      bestExactTablet: bestExactTablet
        ? {
          storeName: bestExactTablet.storeName,
          priceAllMethods: bestExactTablet.priceAllMethods,
          realSavingsCop: bestExactTablet.realSavingsCop,
          isLiveScraped: bestExactTablet.isLiveScraped,
        }
        : null,
      bestLaptopInBudget: bestLaptopInBudget
        ? {
          title: bestLaptopInBudget.title.slice(0, 80),
          storeName: bestLaptopInBudget.storeName,
          priceAllMethods: bestLaptopInBudget.priceAllMethods,
          score: bestLaptopInBudget.laptopSpecs?.hardwareScore ?? null,
          isLiveScraped: bestLaptopInBudget.isLiveScraped,
        }
        : null,
      alertsFoundCount: candidateAlerts.length,
      newAlertsTriggered: persisted.newAlertsToSend.length,
      skippedDuplicateCount: persisted.skippedDuplicateCount,
      whatsappSentCount: notificationResult.sentCount,
      whatsappErrors: notificationResult.whatsappReport?.errors || [],
    };

    if (includeOffers) {
      return NextResponse.json({
        ...compactSummary,
        offers: persisted.enrichedOffers,
        alerts: candidateAlerts,
        notificationResult,
      });
    }

    return NextResponse.json(compactSummary);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        group,
        error: error instanceof Error ? error.message : "Error desconocido",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const originUrl = request.nextUrl.origin;

  try {
    const body = await request.json().catch(() => ({}));
    const notify = body.notify !== false;
    let rawOffers: TrackedOffer[] = [];

    if (Array.isArray(body.offers) && body.offers.length > 0) {
      rawOffers = deduplicateOffers(body.offers);
    } else {
      rawOffers = await runStoreGroupScraper("all");
    }

    const candidateAlerts = detectTriggerableAlerts(rawOffers);
    const persisted = await persistScanAndDeduplicateAlerts({
      offers: rawOffers,
      candidateAlerts,
      willDispatchWhatsApp: notify,
    });

    const notificationResult = notify
      ? await dispatchAlertNotifications(persisted.newAlertsToSend, originUrl)
      : {
        sentCount: 0,
        channelsUsed: [],
        formattedPreview: "Actualización visual sin envío de alertas.",
      };

    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      storageMode: persisted.storageMode,
      persistedOk: persisted.persistedOk,
      totalOffers: persisted.enrichedOffers.length,
      offers: persisted.enrichedOffers,
      alerts: candidateAlerts,
      newAlertsTriggered: persisted.newAlertsToSend.length,
      skippedDuplicateCount: persisted.skippedDuplicateCount,
      notificationResult,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Error al procesar alertas",
      },
      { status: 500 }
    );
  }
}
