import fs from "node:fs/promises";
import path from "node:path";
import { AlertNotificationItem, PriceHistoryPoint, TrackedOffer } from "./types";

export type StorageBackendMode =
  | "upstash-redis"
  | "local-file"
  | "ephemeral-tmp";

export interface AlertedOfferRecord {
  lastPrice: number;
  lastAlertedAt: string;
}

export interface PersistedRadarState {
  lastUpdatedAt: string | null;
  historyByOfferId: Record<string, PriceHistoryPoint[]>;
  alertedByOfferId: Record<string, AlertedOfferRecord>;
  lastOffers: TrackedOffer[];
}

const REDIS_KEY = "radar_blackfriday_co:state:v1";
const MAX_HISTORY_POINTS_PER_OFFER = 120; // ~10 días de barridos cada 2 horas
const MIN_PRICE_DROP_FOR_REPEAT_ALERT = 300000; // Solo re-alertar si baja >= $300.000 COP adicionales
const REPEAT_ALERT_COOLDOWN_MS = 72 * 60 * 60 * 1000; // O si pasaron 72h y sigue en oferta

function getRedisCredentials(): { url: string; token: string } | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    return { url: url.replace(/\/$/, ""), token };
  }
  return null;
}

export function getStorageBackendMode(): StorageBackendMode {
  if (getRedisCredentials()) return "upstash-redis";
  if (process.env.VERCEL) return "ephemeral-tmp";
  return "local-file";
}

function getLocalFilePath(): string {
  if (process.env.VERCEL) {
    return "/tmp/radar-bf-history.json";
  }
  return path.join(process.cwd(), ".data", "history.json");
}

function createEmptyState(): PersistedRadarState {
  return {
    lastUpdatedAt: null,
    historyByOfferId: {},
    alertedByOfferId: {},
    lastOffers: [],
  };
}

export async function loadPersistedState(): Promise<PersistedRadarState> {
  const redis = getRedisCredentials();
  if (redis) {
    try {
      const res = await fetch(`${redis.url}/get/${encodeURIComponent(REDIS_KEY)}`, {
        headers: { Authorization: `Bearer ${redis.token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.result === "string" && data.result.length > 0) {
          const parsed = JSON.parse(data.result) as PersistedRadarState;
          return {
            lastUpdatedAt: parsed.lastUpdatedAt ?? null,
            historyByOfferId: parsed.historyByOfferId ?? {},
            alertedByOfferId: parsed.alertedByOfferId ?? {},
            lastOffers: Array.isArray(parsed.lastOffers) ? parsed.lastOffers : [],
          };
        }
      }
    } catch {
      // Fallback a estado vacío si Redis falla momentáneamente
    }
    return createEmptyState();
  }

  try {
    const filePath = getLocalFilePath();
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as PersistedRadarState;
    return {
      lastUpdatedAt: parsed.lastUpdatedAt ?? null,
      historyByOfferId: parsed.historyByOfferId ?? {},
      alertedByOfferId: parsed.alertedByOfferId ?? {},
      lastOffers: Array.isArray(parsed.lastOffers) ? parsed.lastOffers : [],
    };
  } catch {
    return createEmptyState();
  }
}

export async function savePersistedState(
  state: PersistedRadarState
): Promise<boolean> {
  const serialized = JSON.stringify(state);
  const redis = getRedisCredentials();

  if (redis) {
    try {
      const res = await fetch(`${redis.url}/set/${encodeURIComponent(REDIS_KEY)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${redis.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(serialized),
        signal: AbortSignal.timeout(4000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  try {
    const filePath = getLocalFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, serialized, "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Fusiona las lecturas actuales con el historial real guardado en base de datos,
 * reemplaza el gráfico con los puntos reales históricos acumulados y filtra
 * las alertas para NO repetir el mismo mensaje de WhatsApp cada 2 horas.
 */
export async function persistScanAndDeduplicateAlerts(params: {
  offers: TrackedOffer[];
  candidateAlerts: AlertNotificationItem[];
  willDispatchWhatsApp: boolean;
}): Promise<{
  enrichedOffers: TrackedOffer[];
  newAlertsToSend: AlertNotificationItem[];
  skippedDuplicateCount: number;
  storageMode: StorageBackendMode;
  persistedOk: boolean;
}> {
  const { offers, candidateAlerts, willDispatchWhatsApp } = params;
  const state = await loadPersistedState();
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const storageMode = getStorageBackendMode();

  const updatedHistory: Record<string, PriceHistoryPoint[]> = {
    ...state.historyByOfferId,
  };

  // 1. Registrar puntos reales en el histórico por oferta y enriquecer priceHistory
  const enrichedOffers = offers.map((offer) => {
    const existingSeries = [...(updatedHistory[offer.id] || [])];

    if (offer.isLiveScraped) {
      const lastPt = existingSeries[existingSeries.length - 1];
      const elapsedMs = lastPt
        ? nowMs - new Date(lastPt.timestamp).getTime()
        : Infinity;

      // Guardar punto si cambió el precio o si pasaron >= 20 minutos desde la última lectura
      if (
        !lastPt ||
        lastPt.price !== offer.priceAllMethods ||
        elapsedMs >= 20 * 60 * 1000
      ) {
        existingSeries.push({
          timestamp: nowIso,
          price: offer.priceAllMethods,
        });
      }
    }

    const trimmedSeries = existingSeries.slice(-MAX_HISTORY_POINTS_PER_OFFER);
    if (trimmedSeries.length > 0) {
      updatedHistory[offer.id] = trimmedSeries;
    }

    // Si ya acumulamos >= 2 lecturas reales propias, las mostramos en la gráfica
    const finalHistory =
      trimmedSeries.length >= 2 ? trimmedSeries : offer.priceHistory;

    return {
      ...offer,
      priceHistory: finalHistory,
    };
  });

  // 2. Deduplicar alertas para no hacer spam cada 2 horas
  const updatedAlerted: Record<string, AlertedOfferRecord> = {
    ...state.alertedByOfferId,
  };
  const newAlertsToSend: AlertNotificationItem[] = [];
  let skippedDuplicateCount = 0;

  for (const alert of candidateAlerts) {
    const prev = updatedAlerted[alert.offerId];
    if (!prev) {
      newAlertsToSend.push(alert);
      continue;
    }

    const priceImprovedByEnough =
      prev.lastPrice - alert.priceAllMethods >= MIN_PRICE_DROP_FOR_REPEAT_ALERT;
    const cooldownExpired =
      nowMs - new Date(prev.lastAlertedAt).getTime() >=
      REPEAT_ALERT_COOLDOWN_MS;

    if (priceImprovedByEnough || cooldownExpired) {
      newAlertsToSend.push(alert);
    } else {
      skippedDuplicateCount += 1;
    }
  }

  if (willDispatchWhatsApp && newAlertsToSend.length > 0) {
    for (const sent of newAlertsToSend) {
      updatedAlerted[sent.offerId] = {
        lastPrice: sent.priceAllMethods,
        lastAlertedAt: nowIso,
      };
    }
  }

  const nextState: PersistedRadarState = {
    lastUpdatedAt: nowIso,
    historyByOfferId: updatedHistory,
    alertedByOfferId: updatedAlerted,
    lastOffers: enrichedOffers,
  };

  const persistedOk = await savePersistedState(nextState);

  return {
    enrichedOffers,
    newAlertsToSend,
    skippedDuplicateCount,
    storageMode,
    persistedOk,
  };
}

