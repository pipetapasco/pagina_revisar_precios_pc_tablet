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

const REDIS_STATE_KEY = "radar_blackfriday_co:state:v1";
const REDIS_ALERTED_KEY = "radar_blackfriday_co:alerted:v1";
const MAX_HISTORY_POINTS_PER_OFFER = 120; // ~10 días de barridos cada 2 horas
const MIN_PRICE_DROP_FOR_REPEAT_ALERT = 300000; // Solo re-alertar si baja >= $300.000 COP adicionales

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

/**
 * Decodifica un JSON proveniente de Redis tolerando valores antiguos
 * que pudieran haber quedado doblemente serializados como string.
 */
function safeParseJson<T>(raw: unknown): T | null {
  let current: unknown = raw;
  for (let i = 0; i < 3; i++) {
    if (typeof current !== "string") break;
    const trimmed = current.trim();
    if (!trimmed) return null;
    try {
      current = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (current && typeof current === "object") {
    return current as T;
  }
  return null;
}

async function redisGetJson<T>(
  redis: { url: string; token: string },
  key: string
): Promise<{ ok: boolean; value: T | null }> {
  try {
    const res = await fetch(redis.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redis.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["GET", key]),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, value: null };
    const data = await res.json();
    if (data?.result === null || data?.result === undefined) {
      return { ok: true, value: null };
    }
    return { ok: true, value: safeParseJson<T>(data.result) };
  } catch {
    return { ok: false, value: null };
  }
}

async function redisSetJson(
  redis: { url: string; token: string },
  key: string,
  payload: unknown
): Promise<boolean> {
  try {
    const serialized = JSON.stringify(payload);
    const res = await fetch(redis.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redis.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["SET", key, serialized]),
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function normalizeOfferFingerprint(
  offerId: string,
  title?: string,
  storeName?: string
): string {
  if (title && storeName) {
    const cleanTitle = title
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 42);
    const cleanStore = storeName.toLowerCase().replace(/[^a-z0-9]/g, "");
    return `${cleanStore}:${cleanTitle}`;
  }
  return offerId;
}

export async function loadPersistedStateWithStatus(): Promise<{
  state: PersistedRadarState;
  readOk: boolean;
}> {
  const redis = getRedisCredentials();
  if (redis) {
    const [stateRes, alertedRes] = await Promise.all([
      redisGetJson<PersistedRadarState>(redis, REDIS_STATE_KEY),
      redisGetJson<Record<string, AlertedOfferRecord>>(redis, REDIS_ALERTED_KEY),
    ]);

    const parsedState = stateRes.value;
    const mergedAlerted: Record<string, AlertedOfferRecord> = {
      ...(parsedState?.alertedByOfferId ?? {}),
      ...(alertedRes.value ?? {}),
    };

    return {
      readOk: stateRes.ok && alertedRes.ok,
      state: {
        lastUpdatedAt: parsedState?.lastUpdatedAt ?? null,
        historyByOfferId: parsedState?.historyByOfferId ?? {},
        alertedByOfferId: mergedAlerted,
        lastOffers: Array.isArray(parsedState?.lastOffers)
          ? parsedState.lastOffers
          : [],
      },
    };
  }

  try {
    const filePath = getLocalFilePath();
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = safeParseJson<PersistedRadarState>(raw);
    if (!parsed) {
      return { readOk: true, state: createEmptyState() };
    }
    return {
      readOk: true,
      state: {
        lastUpdatedAt: parsed.lastUpdatedAt ?? null,
        historyByOfferId: parsed.historyByOfferId ?? {},
        alertedByOfferId: parsed.alertedByOfferId ?? {},
        lastOffers: Array.isArray(parsed.lastOffers) ? parsed.lastOffers : [],
      },
    };
  } catch {
    return { readOk: true, state: createEmptyState() };
  }
}

export async function loadPersistedState(): Promise<PersistedRadarState> {
  const { state } = await loadPersistedStateWithStatus();
  return state;
}

export async function savePersistedState(
  state: PersistedRadarState
): Promise<boolean> {
  const redis = getRedisCredentials();

  if (redis) {
    const [alertedOk, stateOk] = await Promise.all([
      redisSetJson(redis, REDIS_ALERTED_KEY, state.alertedByOfferId),
      redisSetJson(redis, REDIS_STATE_KEY, state),
    ]);
    return alertedOk && stateOk;
  }

  try {
    const filePath = getLocalFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(state), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Persiste el histórico real acumulado y devuelve únicamente las alertas nuevas
 * cuyo precio NO haya sido notificado antes (o haya bajado >= $300.000 COP adicionales).
 * Si Redis falla al leer, bloquea el envío por seguridad (fail-safe anti-spam).
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
  storageReadOk: boolean;
  persistedOk: boolean;
}> {
  const { offers, candidateAlerts, willDispatchWhatsApp } = params;
  const { state, readOk } = await loadPersistedStateWithStatus();
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const storageMode = getStorageBackendMode();

  const offerById = new Map<string, TrackedOffer>();
  for (const o of offers) {
    offerById.set(o.id, o);
  }

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

    const finalHistory =
      trimmedSeries.length >= 2 ? trimmedSeries : offer.priceHistory;

    return {
      ...offer,
      priceHistory: finalHistory,
    };
  });

  // 2. Deduplicar alertas de forma estricta (SIN re-envío por tiempo si el precio no bajó >= $300.000)
  const updatedAlerted: Record<string, AlertedOfferRecord> = {
    ...state.alertedByOfferId,
  };
  const newAlertsToSend: AlertNotificationItem[] = [];
  let skippedDuplicateCount = 0;

  // Si Redis está configurado pero falló su lectura, no arriesgar spam repetido
  const allowAlertEvaluation =
    storageMode !== "upstash-redis" || readOk === true;

  if (allowAlertEvaluation) {
    for (const alert of candidateAlerts) {
      const matchedOffer = offerById.get(alert.offerId);
      const fingerprint = normalizeOfferFingerprint(
        alert.offerId,
        matchedOffer?.title,
        alert.storeName
      );

      const prevById = updatedAlerted[alert.offerId];
      const prevByFp = updatedAlerted[fingerprint];
      const prev = prevById || prevByFp;

      if (!prev) {
        newAlertsToSend.push(alert);
        continue;
      }

      const priceDroppedAnother300k =
        prev.lastPrice - alert.priceAllMethods >=
        MIN_PRICE_DROP_FOR_REPEAT_ALERT;

      if (priceDroppedAnother300k) {
        newAlertsToSend.push(alert);
      } else {
        skippedDuplicateCount += 1;
      }
    }
  } else {
    skippedDuplicateCount = candidateAlerts.length;
  }

  if (willDispatchWhatsApp && newAlertsToSend.length > 0) {
    for (const sent of newAlertsToSend) {
      const matchedOffer = offerById.get(sent.offerId);
      const fingerprint = normalizeOfferFingerprint(
        sent.offerId,
        matchedOffer?.title,
        sent.storeName
      );
      const record: AlertedOfferRecord = {
        lastPrice: sent.priceAllMethods,
        lastAlertedAt: nowIso,
      };
      updatedAlerted[sent.offerId] = record;
      updatedAlerted[fingerprint] = record;
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
    storageReadOk: readOk,
    persistedOk,
  };
}
