"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertNotificationItem,
  StoreGroupStatus,
  TrackedOffer,
} from "@/lib/types";
import type { StorageBackendMode } from "@/lib/storage";
import {
  Bell,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  Gamepad2,
  HardDrive,
  Laptop,
  MessageCircle,
  RefreshCw,
  Sparkles,
  Tablet,
} from "lucide-react";

interface Props {
  initialOffers: TrackedOffer[];
  initialAlerts: AlertNotificationItem[];
  initialCheckedAt: string;
  initialStorageMode: StorageBackendMode;
  whatsAppConfigured: boolean;
}

function SourceBadge({ isLive }: { isLive: boolean }) {
  return isLive ? (
    <span className="mt-1 inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
      🟢 En vivo
    </span>
  ) : (
    <span className="mt-1 inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300 ring-1 ring-slate-700">
      📌 Referencia
    </span>
  );
}

const INITIAL_GROUPS: StoreGroupStatus[] = [
  {
    groupId: "alkosto-ktronix",
    groupName: "Alkosto & Ktronix (API Algolia)",
    stores: ["Alkosto", "Ktronix"],
    status: "success",
    offersFound: 0,
  },
  {
    groupId: "falabella-exito",
    groupName: "Falabella & Éxito Oficial",
    stores: ["Falabella", "Éxito"],
    status: "success",
    offersFound: 0,
  },
  {
    groupId: "panamericana-olimpica",
    groupName: "Panamericana & Olímpica (VTEX)",
    stores: ["Panamericana", "Olímpica"],
    status: "success",
    offersFound: 0,
  },
  {
    groupId: "especializadas-marcas",
    groupName: "Samsung, Lenovo, ASUS, HP, Meli, Amazon, Tauret & SpeedLogic",
    stores: [
      "Samsung CO",
      "Lenovo",
      "ASUS",
      "HP",
      "MercadoLibre Oficial",
      "Amazon CO",
      "Tauret",
      "SpeedLogic",
      "Clones y Periféricos",
    ],
    status: "success",
    offersFound: 0,
  },
];

function formatCop(value: number): string {
  return "$" + Math.round(value).toLocaleString("es-CO");
}

export default function PriceRadarDashboard({
  initialOffers,
  initialAlerts,
  initialCheckedAt,
  initialStorageMode,
  whatsAppConfigured,
}: Props) {
  const [offers, setOffers] = useState<TrackedOffer[]>(initialOffers);
  const [alerts, setAlerts] = useState<AlertNotificationItem[]>(initialAlerts);
  const [lastCheckedAt, setLastCheckedAt] = useState<string>(initialCheckedAt);
  const [storageMode, setStorageMode] =
    useState<StorageBackendMode>(initialStorageMode);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [updateCount, setUpdateCount] = useState<number>(1);
  const [groups, setGroups] = useState<StoreGroupStatus[]>(INITIAL_GROUPS);
  const [showOtherTabletVariants, setShowOtherTabletVariants] =
    useState<boolean>(false);
  const [laptopFilter, setLaptopFilter] = useState<
    "all" | "budget" | "caza_mayor" | "watchlist" | "gpu"
  >("all");
  const [laptopSortBy, setLaptopSortBy] = useState<
    "score" | "price_asc" | "real_discount"
  >("score");
  const [copiedWhatsApp, setCopiedWhatsApp] = useState<boolean>(false);
  const [showCronGuide, setShowCronGuide] = useState<boolean>(false);
  const [whatsAppStatusMsg, setWhatsAppStatusMsg] = useState<string | null>(
    null
  );
  const [isTestingWhatsApp, setIsTestingWhatsApp] = useState<boolean>(false);
  const [isMounted, setIsMounted] = useState<boolean>(false);
  const isUpdatingRef = useRef<boolean>(false);
  const didInitialMountRunRef = useRef<boolean>(false);

  const handleTestWhatsApp = useCallback(async () => {
    if (isTestingWhatsApp) return;
    setIsTestingWhatsApp(true);
    setWhatsAppStatusMsg("Enviando mensaje de prueba por Meta API...");
    try {
      const res = await fetch("/api/actualizar?testWhatsapp=1", {
        cache: "no-store",
      });
      const data = await res.json();
      const report = data.whatsappReport;
      if (data.ok && report?.sentCount > 0) {
        setWhatsAppStatusMsg(
          `✅ Mensaje enviado por Meta API (${report.sentCount}/${report.recipientsCount} destinatarios, plantilla: ${report.templateName}).`
        );
      } else {
        const err =
          report?.errors?.[0] ||
          data.error ||
          "No se pudo enviar. Revisa WA_TOKEN o variables en Vercel.";
        setWhatsAppStatusMsg(`⚠️ Error Meta API: ${err}`);
      }
    } catch (err) {
      setWhatsAppStatusMsg(
        `⚠️ Error de red: ${
          err instanceof Error ? err.message : "Desconocido"
        }`
      );
    } finally {
      setIsTestingWhatsApp(false);
    }
  }, [isTestingWhatsApp]);

  /**
   * Ejecuta la actualización dividida en 4 grupos rápidos en paralelo
   * para evitar cualquier timeout de Vercel Gratis (10s) cuando el Cron presione el botón.
   */
  const runLiveScan = useCallback(async (sendNotifications: boolean) => {
    if (isUpdatingRef.current) return;
    isUpdatingRef.current = true;
    setIsUpdating(true);

    setGroups((prev) =>
      prev.map((g) => ({ ...g, status: "loading", lastError: undefined }))
    );

    const groupIds = INITIAL_GROUPS.map((g) => g.groupId);
    const collectedOffers: TrackedOffer[] = [];

    await Promise.all(
      groupIds.map(async (groupId) => {
        const t0 = Date.now();
        try {
          const res = await fetch(
            `/api/actualizar?group=${encodeURIComponent(groupId)}&notify=false`,
            { cache: "no-store" }
          );
          const data = await res.json();
          const durationMs = Date.now() - t0;

          if (data.ok && Array.isArray(data.offers)) {
            collectedOffers.push(...data.offers);
            setGroups((prev) =>
              prev.map((g) =>
                g.groupId === groupId
                  ? {
                      ...g,
                      status: "success",
                      offersFound: data.offers.length,
                      durationMs,
                    }
                  : g
              )
            );
          } else {
            setGroups((prev) =>
              prev.map((g) =>
                g.groupId === groupId
                  ? {
                      ...g,
                      status: "error",
                      durationMs,
                      lastError: data.error || "Error de conexión",
                    }
                  : g
              )
            );
          }
        } catch (err) {
          setGroups((prev) =>
            prev.map((g) =>
              g.groupId === groupId
                ? {
                    ...g,
                    status: "error",
                    lastError:
                      err instanceof Error ? err.message : "Timeout de red",
                  }
                : g
            )
          );
        }
      })
    );

    if (collectedOffers.length > 0) {
      let finalOffers = collectedOffers;

      // Consolidar historial real en BD y (si sendNotifications=true) despachar a Meta WhatsApp
      try {
        const alertRes = await fetch("/api/actualizar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offers: collectedOffers,
            notify: sendNotifications,
          }),
        });
        const alertData = await alertRes.json();
        if (alertData.ok) {
          if (Array.isArray(alertData.offers)) {
            finalOffers = alertData.offers;
          }
          if (Array.isArray(alertData.alerts)) {
            setAlerts(alertData.alerts);
          }
          if (alertData.storageMode) {
            setStorageMode(alertData.storageMode);
          }
          if (sendNotifications && alertData.notificationResult) {
            const wa = alertData.notificationResult.whatsappReport;
            if (wa && wa.sentCount > 0) {
              setWhatsAppStatusMsg(
                `📲 Aviso enviado a WhatsApp (${wa.sentCount} destinatarios).`
              );
            } else if (wa && wa.errors?.length > 0) {
              setWhatsAppStatusMsg(`⚠️ WhatsApp: ${wa.errors[0]}`);
            } else if (alertData.skippedDuplicateCount > 0) {
              setWhatsAppStatusMsg(
                "🔕 Sin WhatsApp repetido: ninguna oferta nueva bajó al menos $300.000 COP adicionales desde la última alerta."
              );
            }
          }
        }
      } catch {
        // Ignorar si falla la persistencia secundaria
      }

      const nowIso = new Date().toISOString();
      setOffers(finalOffers);
      setLastCheckedAt(nowIso);
      setUpdateCount((c) => c + 1);

      try {
        localStorage.setItem(
          "radar_blackfriday_cache_v1",
          JSON.stringify({
            offers: finalOffers,
            checkedAt: nowIso,
          })
        );
      } catch {
        // Ignorar errores de cuota en localStorage
      }
    }

    isUpdatingRef.current = false;
    setIsUpdating(false);
  }, []);

  const handleUpdateAllPrices = useCallback(() => {
    void runLiveScan(false);
  }, [runLiveScan]);

  // Al montar: evita hydration mismatch y dispara el primer escaneo en vivo en segundo plano
  // (con notificaciones solo si la URL trae ?auto=true o ?cron=1).
  useEffect(() => {
    setIsMounted(true);
    if (didInitialMountRunRef.current) return;
    didInitialMountRunRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const isCronAuto =
      params.get("auto") === "true" || params.get("cron") === "1";

    void runLiveScan(isCronAuto);
  }, [runLiveScan]);

  // Separar ofertas de Tablet y de Portátil
  const tabletOffers = useMemo(() => {
    const allTabs = offers
      .filter((o) => o.category === "tablet")
      .sort((a, b) => a.priceAllMethods - b.priceAllMethods);

    if (showOtherTabletVariants) return allTabs;
    return allTabs.filter((o) => o.tabletSpecs?.isExactTarget);
  }, [offers, showOtherTabletVariants]);

  const exactTargetTablets = useMemo(
    () =>
      offers
        .filter(
          (o) =>
            o.category === "tablet" &&
            o.tabletSpecs?.modelVariant ===
              "S10 FE+ 12GB / 256GB (Objetivo Exacto)"
        )
        .sort((a, b) => a.priceAllMethods - b.priceAllMethods),
    [offers]
  );

  const bestExactTablet = exactTargetTablets[0] || tabletOffers[0];

  const laptopOffers = useMemo(() => {
    let list = offers.filter((o) => o.category === "laptop");

    if (laptopFilter === "budget") {
      list = list.filter((o) => o.priceAllMethods <= 2950000);
    } else if (laptopFilter === "caza_mayor") {
      list = list.filter((o) => o.authenticity === "caza_mayor");
    } else if (laptopFilter === "watchlist") {
      list = list.filter((o) => o.priceAllMethods > 2950000);
    } else if (laptopFilter === "gpu") {
      list = list.filter((o) => o.laptopSpecs?.hasDedicatedGpu);
    }

    return [...list].sort((a, b) => {
      if (laptopSortBy === "price_asc") {
        return a.priceAllMethods - b.priceAllMethods;
      }
      if (laptopSortBy === "real_discount") {
        return b.realDiscountPct - a.realDiscountPct;
      }
      // Por defecto: Mayor Score de Hardware + bono si está dentro del presupuesto (<= 2.95M)
      const aInBudget = a.priceAllMethods <= 2950000 ? 6 : 0;
      const bInBudget = b.priceAllMethods <= 2950000 ? 6 : 0;
      return (
        (b.laptopSpecs?.hardwareScore || 0) +
        bInBudget -
        ((a.laptopSpecs?.hardwareScore || 0) + aInBudget)
      );
    });
  }, [offers, laptopFilter, laptopSortBy]);

  const bestLaptopInBudget = useMemo(
    () =>
      offers
        .filter((o) => o.category === "laptop" && o.priceAllMethods <= 2950000)
        .sort(
          (a, b) =>
            (b.laptopSpecs?.hardwareScore || 0) -
            (a.laptopSpecs?.hardwareScore || 0)
        )[0],
    [offers]
  );

  const formattedWhatsAppSummary = useMemo(() => {
    const lines = [
      `🔥 *REPORTE BLACK FRIDAY COLOMBIA (${new Date(
        lastCheckedAt
      ).toLocaleTimeString("es-CO", {
        hour: "2-digit",
        minute: "2-digit",
      })})*`,
      "",
    ];
    if (bestExactTablet) {
      lines.push(
        `📱 *Mejor Precio Galaxy Tab S10 FE+ (12GB/256GB):*`,
        `• *${formatCop(bestExactTablet.priceAllMethods)}* (Todo medio de pago) en *${bestExactTablet.storeName}*`,
        `• Ahorro real vs línea base: ${formatCop(bestExactTablet.realSavingsCop)} (-${bestExactTablet.realDiscountPct}% real)`,
        `• Link: ${bestExactTablet.url}`,
        ""
      );
    }
    if (bestLaptopInBudget) {
      lines.push(
        `💻 *Mejor Portátil en Rango Hoy (<= $2.95M):*`,
        `• *${bestLaptopInBudget.title}*`,
        `• Precio: *${formatCop(bestLaptopInBudget.priceAllMethods)}* en *${bestLaptopInBudget.storeName}*`,
        `• Score Hardware: ${bestLaptopInBudget.laptopSpecs?.hardwareScore}/100 | ${bestLaptopInBudget.laptopSpecs?.minecraftPerformance}`,
        `• Link: ${bestLaptopInBudget.url}`
      );
    }
    return lines.join("\n");
  }, [bestExactTablet, bestLaptopInBudget, lastCheckedAt]);

  const copySummaryToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(formattedWhatsAppSummary);
      setCopiedWhatsApp(true);
      setTimeout(() => setCopiedWhatsApp(false), 2500);
    } catch {
      // Ignorar si clipboard no está disponible
    }
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 pb-20">
      {/* BARRA SUPERIOR Y BOTÓN DE CRON GRATUITO */}
      <header className="lg:sticky lg:top-0 z-30 border-b border-slate-800/80 bg-[#090d16]/95 lg:backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                  <Sparkles className="h-3.5 w-3.5" />
                  Radar Anti-Precios Inflados • Black Friday Colombia
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
                  <Clock className="h-3.5 w-3.5 text-sky-400" />
                  Frecuencia: Cada 2 horas
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                    whatsAppConfigured
                      ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                      : "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
                  }`}
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  {whatsAppConfigured
                    ? "WhatsApp Meta API Listo"
                    : "Falta configurar Meta API"}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                    storageMode === "upstash-redis"
                      ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30"
                      : storageMode === "local-file"
                      ? "bg-slate-800 text-slate-300"
                      : "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
                  }`}
                >
                  <Database className="h-3.5 w-3.5" />
                  {storageMode === "upstash-redis"
                    ? "Historial: Upstash Redis (Vercel)"
                    : storageMode === "local-file"
                    ? "Historial: Archivo Local (.data)"
                    : "Historial Temporal (Conectar Upstash en Vercel)"}
                </span>
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Monitor de Precios Reales: Galaxy Tab S10 FE+ &amp; Portátil Ideal
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Priorizando siempre{" "}
                <strong className="text-slate-200">
                  Precio Todo Medio de Pago (PSE / Débito)
                </strong>{" "}
                y verificando descuentos reales contra nuestra línea base pre-Black Friday.
              </p>
            </div>

            {/* BOTÓN PRINCIPAL PARA EL SERVICIO DE CRON GRATUITO Y USO MANUAL */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                id="btn-actualizar-precios"
                data-cron-action="update-all-stores"
                type="button"
                onClick={handleUpdateAllPrices}
                disabled={isUpdating}
                className="inline-flex w-full sm:w-auto justify-center items-center gap-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:from-emerald-400 hover:to-teal-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 disabled:cursor-wait disabled:opacity-70"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isUpdating ? "animate-spin" : ""}`}
                />
                {isUpdating
                  ? "Consultando Tiendas en Vivo..."
                  : "Actualizar Precios Ahora"}
              </button>

              <button
                type="button"
                onClick={handleTestWhatsApp}
                disabled={isTestingWhatsApp}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-3 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
              >
                <MessageCircle className="h-4 w-4" />
                {isTestingWhatsApp ? "Enviando..." : "Probar WhatsApp"}
              </button>

              <button
                type="button"
                onClick={() => setShowCronGuide((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-3 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
              >
                <Bell className="h-4 w-4 text-amber-400" />
                Guía Vercel + Cron (2h)
              </button>
            </div>
          </div>

          {whatsAppStatusMsg && (
            <div className="mt-3 rounded-xl border border-slate-700 bg-slate-900/90 px-3.5 py-2 text-xs text-slate-200">
              {whatsAppStatusMsg}
            </div>
          )}

          {/* ESTADO EN VIVO DE LOS GRUPOS DE TIENDAS (ANTI-TIMEOUT VERCEL) */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-xs text-slate-400">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-300">
                Estado por bloques (Anti-Timeout Vercel):
              </span>
              {groups.map((g) => (
                <span
                  key={g.groupId}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium ${
                    g.status === "loading"
                      ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30"
                      : g.status === "error"
                      ? "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30"
                      : "bg-slate-800/90 text-slate-300"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      g.status === "loading"
                        ? "animate-ping bg-sky-400"
                        : g.status === "error"
                        ? "bg-rose-400"
                        : "bg-emerald-400"
                    }`}
                  />
                  {g.groupName.split("(")[0].trim()}
                  {g.durationMs ? ` (${(g.durationMs / 1000).toFixed(1)}s)` : ""}
                </span>
              ))}
            </div>
            <div className="text-right">
              Último barrido:{" "}
              <strong className="text-slate-200" suppressHydrationWarning>
                {isMounted
                  ? new Date(lastCheckedAt).toLocaleString("es-CO", {
                      dateStyle: "short",
                      timeStyle: "medium",
                    })
                  : "Sincronizando..."}
              </strong>{" "}
              (Lectura #{updateCount})
            </div>
          </div>

          {/* PANEL EXPLICATIVO PARA CONECTAR EL CRON GRATUITO */}
          {showCronGuide && (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-xs text-amber-100">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-bold text-amber-300">
                    ⚡ Configuración en Vercel + cron-job.org (Cada 2 horas)
                  </h2>
                  <ul className="mt-2 list-disc space-y-1.5 pl-5 text-slate-200">
                    <li>
                      <strong>1. Base de datos gratis en Vercel (para historial y no repetir WhatsApp):</strong>{" "}
                      En tu proyecto de Vercel ve a <em>Storage → Browse Marketplace → Upstash Redis (Free) → Connect</em>. Vercel inyecta las variables automáticamente y el badge de arriba cambiará a <strong>Historial: Upstash Redis</strong>.
                    </li>
                    <li>
                      <strong>2. Cron cada 2 horas (cron-job.org):</strong> Crea un cron gratis en{" "}
                      <code className="rounded bg-slate-900 px-1.5 py-0.5 text-sky-300">
                        cron-job.org
                      </code>{" "}
                      con expresión{" "}
                      <code className="rounded bg-slate-900 px-1.5 py-0.5 text-emerald-300">
                        0 */2 * * *
                      </code>{" "}
                      apuntando a{" "}
                      <code className="rounded bg-slate-900 px-1.5 py-0.5 text-sky-300">
                        https://TU-URL.vercel.app/api/actualizar?group=all&amp;notify=true
                      </code>
                      .
                    </li>
                    <li>
                      <strong>3. Si prefieres un automatizador que presione el botón:</strong>{" "}
                      Usa el selector{" "}
                      <code className="rounded bg-slate-900 px-1.5 py-0.5 text-emerald-300">
                        #btn-actualizar-precios
                      </code>{" "}
                      o abre{" "}
                      <code className="rounded bg-slate-900 px-1.5 py-0.5 text-sky-300">
                        https://TU-URL.vercel.app/?auto=true
                      </code>
                      .
                    </li>
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCronGuide(false)}
                  className="rounded-lg bg-slate-800 px-2.5 py-1 text-slate-300 hover:bg-slate-700"
                >
                  Cerrar
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-12 px-4 pt-8 sm:px-6 lg:px-8">
        {/* RESUMEN RÁPIDO DE LOS 2 OBJETIVOS */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* TARJETA RESUMEN 1: GALAXY TAB S10 FE+ 12GB/256GB */}
          {bestExactTablet && (
            <div className="relative min-w-0 rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/30 p-5 sm:p-6 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300">
                  <Tablet className="h-3.5 w-3.5" />
                  OBJETIVO 1: TABLET EXACTA (12GB RAM / 256GB)
                </span>
                <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300">
                  Mejor Tienda Hoy: {bestExactTablet.storeName}
                </span>
              </div>

              <h2 className="mt-3 text-xl font-bold text-white">
                {bestExactTablet.title}
              </h2>

              <div className="mt-4 flex flex-wrap items-baseline gap-4">
                <div>
                  <span className="block text-xs uppercase tracking-wider text-slate-400">
                    Mejor Precio Todo Medio de Pago (PSE)
                  </span>
                  <span className="text-3xl font-extrabold text-emerald-400">
                    {formatCop(bestExactTablet.priceAllMethods)}
                  </span>
                </div>

                {bestExactTablet.storeCrossedPrice && (
                  <div>
                    <span className="block text-xs text-slate-400">
                      &ldquo;Antes&rdquo; según tienda
                    </span>
                    <span className="text-sm text-slate-400 line-through">
                      {formatCop(bestExactTablet.storeCrossedPrice)} (-
                      {bestExactTablet.storeClaimedDiscountPct}%)
                    </span>
                  </div>
                )}

                <div className="rounded-xl border border-slate-700/80 bg-slate-800/60 px-3 py-2">
                  <span className="block text-xs text-slate-400">
                    Línea Base Real Pre-BF
                  </span>
                  <span className="text-sm font-bold text-slate-200">
                    {formatCop(bestExactTablet.historicalBaselinePrice)}{" "}
                    <span className="text-emerald-400">
                      (Ahorro real: {formatCop(bestExactTablet.realSavingsCop)} / -
                      {bestExactTablet.realDiscountPct}%)
                    </span>
                  </span>
                </div>
              </div>

              <p className="mt-3 text-xs text-slate-300">
                {bestExactTablet.authenticityReason}
              </p>

              {/* MINI GRÁFICO DE EVOLUCIÓN DE PRECIO */}
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Evolución en barridos de 2 horas (Línea base vs Hoy)</span>
                  <span className="font-semibold text-emerald-400">
                    Mínimo actual: {formatCop(bestExactTablet.priceAllMethods)}
                  </span>
                </div>
                <div className="mt-2 flex items-end gap-2 h-12">
                  {bestExactTablet.priceHistory.map((pt, idx) => {
                    const maxP = Math.max(
                      ...bestExactTablet.priceHistory.map((x) => x.price)
                    );
                    const minP = Math.min(
                      ...bestExactTablet.priceHistory.map((x) => x.price)
                    );
                    const range = Math.max(100000, maxP - minP);
                    const heightPct = Math.round(
                      35 + ((pt.price - minP) / range) * 60
                    );
                    const isLast =
                      idx === bestExactTablet.priceHistory.length - 1;
                    return (
                      <div
                        key={pt.timestamp}
                        className="flex-1 flex flex-col items-center gap-1"
                        title={
                          isMounted
                            ? `${new Date(pt.timestamp).toLocaleString(
                                "es-CO"
                              )}: ${formatCop(pt.price)}`
                            : formatCop(pt.price)
                        }
                      >
                        <div
                          style={{ height: `${heightPct}%` }}
                          className={`w-full rounded-t transition-all ${
                            isLast
                              ? "bg-emerald-400 shadow-sm shadow-emerald-400/50"
                              : "bg-slate-700 hover:bg-slate-600"
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-md bg-slate-800 px-2.5 py-1 text-slate-200">
                    RAM: {bestExactTablet.tabletSpecs?.ramGb} GB
                  </span>
                  <span className="rounded-md bg-slate-800 px-2.5 py-1 text-slate-200">
                    Almacenamiento: {bestExactTablet.tabletSpecs?.storageGb} GB
                  </span>
                  {bestExactTablet.tabletSpecs?.includesKeyboard && (
                    <span className="rounded-md bg-indigo-500/20 px-2.5 py-1 font-medium text-indigo-300">
                      + Incluye Teclado Book Cover
                    </span>
                  )}
                </div>

                <a
                  href={bestExactTablet.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="touch-target inline-flex w-full sm:w-auto justify-center items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
                >
                  Ver en {bestExactTablet.storeName}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          )}

          {/* TARJETA RESUMEN 2: MEJOR PORTÁTIL EN RANGO PARA TU NOVIA */}
          {bestLaptopInBudget && (
            <div className="relative min-w-0 rounded-2xl border border-sky-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-sky-950/30 p-5 sm:p-6 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/20 px-3 py-1 text-xs font-bold text-sky-300">
                  <Laptop className="h-3.5 w-3.5" />
                  OBJETIVO 2: MEJOR PORTÁTIL EN RANGO ($2.5M – $2.9M)
                </span>
                <span className="rounded-lg bg-amber-500/20 px-2.5 py-1 text-xs font-bold text-amber-300">
                  Score Hardware: {bestLaptopInBudget.laptopSpecs?.hardwareScore}
                  /100
                </span>
              </div>

              <h2 className="mt-3 text-xl font-bold text-white">
                {bestLaptopInBudget.title}
              </h2>

              <div className="mt-4 flex flex-wrap items-baseline gap-4">
                <div>
                  <span className="block text-xs uppercase tracking-wider text-slate-400">
                    Precio Todo Medio de Pago (PSE)
                  </span>
                  <span className="text-3xl font-extrabold text-sky-400">
                    {formatCop(bestLaptopInBudget.priceAllMethods)}
                  </span>
                </div>

                <div className="rounded-xl border border-slate-700/80 bg-slate-800/60 px-3 py-2">
                  <span className="block text-xs text-slate-400">
                    Valor Normal por estos Componentes
                  </span>
                  <span className="text-sm font-bold text-slate-200">
                    {formatCop(bestLaptopInBudget.historicalBaselinePrice)}{" "}
                    <span className="text-emerald-400">
                      (Ahorro real: {formatCop(bestLaptopInBudget.realSavingsCop)}{" "}
                      / -{bestLaptopInBudget.realDiscountPct}%)
                    </span>
                  </span>
                </div>
              </div>

              <p className="mt-3 text-xs text-slate-300">
                {bestLaptopInBudget.authenticityReason}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs sm:grid-cols-4">
                <div>
                  <span className="text-slate-400 block">Procesador</span>
                  <strong className="text-slate-100">
                    {bestLaptopInBudget.laptopSpecs?.cpuModel}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block">RAM &amp; Disco</span>
                  <strong className="text-slate-100">
                    {bestLaptopInBudget.laptopSpecs?.ramGb}GB /{" "}
                    {bestLaptopInBudget.laptopSpecs?.ssdGb === 1024
                      ? "1TB SSD"
                      : `${bestLaptopInBudget.laptopSpecs?.ssdGb}GB SSD`}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Minecraft</span>
                  <strong className="text-emerald-300">
                    {bestLaptopInBudget.laptopSpecs?.minecraftPerformance}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Para dar clases</span>
                  <strong className="text-sky-300">
                    {bestLaptopInBudget.laptopSpecs?.teachingDurability}
                  </strong>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-200">
                  {bestLaptopInBudget.authenticityLabel} en{" "}
                  {bestLaptopInBudget.storeName}
                </span>

                <a
                  href={bestLaptopInBudget.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="touch-target inline-flex w-full sm:w-auto justify-center items-center gap-1.5 rounded-xl bg-sky-400 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-sky-300"
                >
                  Ver Oferta en {bestLaptopInBudget.storeName}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          )}
        </section>

        {/* SECCIÓN 1 DETALLADA: COMPARADOR GALAXY TAB S10 FE+ (12GB / 256GB) */}
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Tablet className="h-5 w-5 text-emerald-400" />
                1. Comparativa en Tiendas: Samsung Galaxy Tab S10 FE+ (12GB RAM / 256GB)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Separamos estrictamente el modelo de{" "}
                <strong className="text-emerald-300">12GB RAM + 256GB</strong>{" "}
                de las versiones recortadas de 8GB/128GB para que no haya falsas alarmas de precio.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowOtherTabletVariants((v) => !v)}
              className="self-start rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
            >
              {showOtherTabletVariants
                ? "Mostrar SOLO versión 12GB / 256GB"
                : "Ver también variante 8GB / 128GB como referencia"}
            </button>
          </div>

          <div
            tabIndex={0}
            role="region"
            aria-labelledby="tablet-table-caption"
            className="table-wrapper"
          >
            <table className="tablet-comparison-table text-left text-sm">
              <caption
                id="tablet-table-caption"
                className="sr-only"
              >
                Comparativa de precios reales para la Samsung Galaxy Tab S10 FE+ 12GB RAM y 256GB en tiendas de Colombia
              </caption>
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400">
                  <th scope="col" className="py-3.5 px-4">
                    Modelo / Configuración
                  </th>
                  <th scope="col" className="py-3.5 px-4">
                    Tienda / Vendedor
                  </th>
                  <th scope="col" className="py-3.5 px-4">
                    Precio Todo Medio de Pago
                  </th>
                  <th scope="col" className="py-3.5 px-4">
                    &ldquo;Antes&rdquo; Tienda vs Base Real
                  </th>
                  <th scope="col" className="py-3.5 px-4">
                    Auditoría Anti-Humo
                  </th>
                  <th scope="col" className="py-3.5 px-4 text-right">
                    Enlace
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {tabletOffers.map((tab, idx) => (
                  <tr
                    key={tab.id}
                    className="transition hover:bg-slate-800/40"
                  >
                    <th scope="row" className="py-4 px-4 font-medium text-white">
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {idx === 0 && tab.tabletSpecs?.isExactTarget && (
                            <span className="rounded bg-emerald-500 px-2 py-0.5 text-[11px] font-bold text-slate-950">
                              🏆 MÁS BARATA HOY
                            </span>
                          )}
                          <span
                            className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                              tab.tabletSpecs?.isExactTarget
                                ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                                : "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
                            }`}
                          >
                            {tab.tabletSpecs?.modelVariant}
                          </span>
                        </div>
                        <span className="text-sm font-semibold text-slate-100">
                          {tab.title}
                        </span>
                        <span className="text-xs text-slate-400">
                          RAM: {tab.tabletSpecs?.ramGb}GB • Almacenamiento:{" "}
                          {tab.tabletSpecs?.storageGb}GB • Pantalla:{" "}
                          {tab.tabletSpecs?.screenInches}
                          {tab.tabletSpecs?.includesKeyboard
                            ? " • ⌨️ Incluye Book Cover Keyboard"
                            : " • 🖊️ Incluye S-Pen"}
                        </span>
                      </div>
                    </th>

                    <td className="py-4 px-4">
                      <div className="font-semibold text-slate-200">
                        {tab.storeName}
                      </div>
                      <div className="text-xs text-slate-400">
                        {tab.sellerName}
                      </div>
                      <SourceBadge isLive={tab.isLiveScraped} />
                    </td>

                    <td className="py-4 px-4">
                      <div className="text-lg font-extrabold text-emerald-400">
                        {formatCop(tab.priceAllMethods)}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        PSE / Débito / Cualquier tarjeta
                      </div>
                      {tab.priceCardSpecial && (
                        <div className="mt-1 rounded bg-slate-800/90 px-2 py-0.5 text-[11px] text-amber-300">
                          Con {tab.cardName}: {formatCop(tab.priceCardSpecial)}
                        </div>
                      )}
                    </td>

                    <td className="py-4 px-4 text-xs">
                      {tab.storeCrossedPrice ? (
                        <div className="text-slate-400">
                          Tachado tienda:{" "}
                          <span className="line-through">
                            {formatCop(tab.storeCrossedPrice)}
                          </span>{" "}
                          (-{tab.storeClaimedDiscountPct}%)
                        </div>
                      ) : (
                        <div className="text-slate-500">
                          Sin precio tachado inflado
                        </div>
                      )}
                      <div className="mt-1 font-medium text-slate-200">
                        Base real pre-BF:{" "}
                        {formatCop(tab.historicalBaselinePrice)}
                      </div>
                      <div
                        className={`mt-0.5 font-bold ${
                          tab.realDiscountPct > 0
                            ? "text-emerald-400"
                            : "text-slate-400"
                        }`}
                      >
                        {tab.realDiscountPct > 0
                          ? `Ahorro Real: ${formatCop(tab.realSavingsCop)} (-${tab.realDiscountPct}% real)`
                          : "En línea con el precio base"}
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold ${
                          tab.authenticity === "verified_real_deal" ||
                          tab.authenticity === "caza_mayor"
                            ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                            : tab.authenticity === "inflated_fake_discount"
                            ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
                            : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {tab.authenticityLabel}
                      </span>
                      <p className="mt-1 text-xs text-slate-400 md:max-w-xs">
                        {tab.authenticityReason}
                      </p>
                    </td>

                    <td className="py-4 px-4 md:text-right">
                      <a
                        href={tab.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="touch-target inline-flex w-full md:w-auto justify-center items-center gap-1 rounded-lg bg-slate-800 px-3 py-2.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500 hover:text-slate-950"
                      >
                        Ir a Tienda
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* SECCIÓN 2 DETALLADA: CAZADOR INTELIGENTE DE PORTÁTILES PARA TU NOVIA */}
        <section className="space-y-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Laptop className="h-5 w-5 text-sky-400" />
                  2. Radar Inteligente del Mejor Portátil (Clases + Durabilidad + Minecraft)
                </h2>
                <p className="mt-1 text-xs text-slate-300">
                  Filtrando automáticamente todas las tiendas con tus reglas:{" "}
                  <strong className="text-sky-300">Mínimo 16 GB RAM</strong> +{" "}
                  <strong className="text-sky-300">
                    Gran Procesador (Ryzen 5/7 o Core i5/i7/Ultra)
                  </strong>{" "}
                  +{" "}
                  <strong className="text-emerald-300">
                    Bonus por GPU Dedicada (RTX)
                  </strong>
                  . Vigilamos también equipos de <strong>$3.0M a $4.3M</strong>{" "}
                  por si en Black Friday se desploman a tu rango de{" "}
                  <strong>$2.5M – $2.9M (o menos)</strong>.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label
                  htmlFor="sort-laptops"
                  className="text-xs font-medium text-slate-400"
                >
                  Ordenar por:
                </label>
                <select
                  id="sort-laptops"
                  value={laptopSortBy}
                  onChange={(e) =>
                    setLaptopSortBy(
                      e.target.value as "score" | "price_asc" | "real_discount"
                    )
                  }
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-white"
                >
                  <option value="score">
                    🏆 Mejor Relación Componentes / Precio (Recomendado)
                  </option>
                  <option value="price_asc">
                    💰 Menor Precio Todo Medio de Pago
                  </option>
                  <option value="real_discount">
                    📉 Mayor % de Descuento Real Verificado
                  </option>
                </select>
              </div>
            </div>

            {/* PESTAÑAS / FILTROS DE PORTÁTILES */}
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                {
                  id: "all",
                  label: `Todos los Clasificados (${
                    offers.filter((o) => o.category === "laptop").length
                  })`,
                },
                {
                  id: "budget",
                  label: `🎯 En Presupuesto Hoy <= $2.95M (${
                    offers.filter(
                      (o) =>
                        o.category === "laptop" && o.priceAllMethods <= 2950000
                    ).length
                  })`,
                },
                {
                  id: "caza_mayor",
                  label: `🚨 Caza Mayor: Gama Alta en Rango (${
                    offers.filter(
                      (o) =>
                        o.category === "laptop" &&
                        o.authenticity === "caza_mayor"
                    ).length
                  })`,
                },
                {
                  id: "gpu",
                  label: `🎮 Con Tarjeta Gráfica RTX (${
                    offers.filter(
                      (o) =>
                        o.category === "laptop" &&
                        o.laptopSpecs?.hasDedicatedGpu
                    ).length
                  })`,
                },
                {
                  id: "watchlist",
                  label: `🔭 En Vigilancia ($2.95M – $4.3M esperando bajón) (${
                    offers.filter(
                      (o) =>
                        o.category === "laptop" && o.priceAllMethods > 2950000
                    ).length
                  })`,
                },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() =>
                    setLaptopFilter(
                      tab.id as
                        | "all"
                        | "budget"
                        | "caza_mayor"
                        | "watchlist"
                        | "gpu"
                    )
                  }
                  className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                    laptopFilter === tab.id
                      ? "bg-sky-500 text-slate-950 shadow-md shadow-sky-500/20"
                      : "bg-slate-800/90 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* TABLA COMPARATIVA DE PORTÁTILES */}
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="laptop-table-caption"
            className="table-wrapper"
          >
            <table className="laptop-comparison-table text-left text-sm">
              <caption id="laptop-table-caption" className="sr-only">
                Ranking de portátiles con mínimo 16GB de RAM evaluados por procesador, durabilidad para dar clases, rendimiento en Minecraft y autenticidad del descuento
              </caption>
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400">
                  <th scope="col" className="py-3.5 px-4">
                    Portátil &amp; Veredicto
                  </th>
                  <th scope="col" className="py-3.5 px-4">
                    Tienda
                  </th>
                  <th scope="col" className="py-3.5 px-4">
                    Componentes Clave (CPU / RAM / GPU)
                  </th>
                  <th scope="col" className="py-3.5 px-4">
                    Score &amp; Minecraft
                  </th>
                  <th scope="col" className="py-3.5 px-4">
                    Precio Todo Medio de Pago
                  </th>
                  <th scope="col" className="py-3.5 px-4">
                    Auditoría Anti-Humo
                  </th>
                  <th scope="col" className="py-3.5 px-4 text-right">
                    Enlace
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {laptopOffers.map((lap, index) => (
                  <tr
                    key={lap.id}
                    className="transition hover:bg-slate-800/40"
                  >
                    <th scope="row" className="py-4 px-4 font-medium text-white md:max-w-md">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        {index === 0 && (
                          <span className="rounded bg-amber-400 px-2 py-0.5 text-[11px] font-extrabold text-slate-950">
                            ⭐ TOP #1 RECOMENDADO
                          </span>
                        )}
                        {lap.priceAllMethods <= 2950000 ? (
                          <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                            Dentro de Presupuesto
                          </span>
                        ) : (
                          <span className="rounded bg-purple-500/20 px-2 py-0.5 text-[11px] font-semibold text-purple-300">
                            🔭 En Vigilancia (Esperando que baje a &lt;$2.9M)
                          </span>
                        )}
                        {lap.laptopSpecs?.hasDedicatedGpu && (
                          <span className="rounded bg-indigo-500/25 px-2 py-0.5 text-[11px] font-bold text-indigo-300 ring-1 ring-indigo-500/40">
                            🎮 GPU Dedicada
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-bold text-slate-100">
                        {lap.title}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {lap.laptopSpecs?.scoreBreakdown.reasons[0]}
                      </div>
                    </th>

                    <td className="py-4 px-4">
                      <div className="font-semibold text-slate-200">
                        {lap.storeName}
                      </div>
                      <div className="text-xs text-slate-400">
                        {lap.sellerName}
                      </div>
                      <SourceBadge isLive={lap.isLiveScraped} />
                    </td>

                    <td className="py-4 px-4 text-xs space-y-1">
                      <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
                        <Cpu className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                        {lap.laptopSpecs?.cpuModel}
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-300">
                        <HardDrive className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        {lap.laptopSpecs?.ramGb} GB RAM •{" "}
                        {lap.laptopSpecs?.ssdGb === 1024
                          ? "1 TB SSD NVMe"
                          : `${lap.laptopSpecs?.ssdGb} GB SSD NVMe`}
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-300">
                        <Gamepad2 className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                        {lap.laptopSpecs?.gpuModel}
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      <div className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-extrabold text-amber-300">
                        Score: {lap.laptopSpecs?.hardwareScore} / 100
                      </div>
                      <div className="mt-1 text-xs font-medium text-emerald-300">
                        Minecraft: {lap.laptopSpecs?.minecraftPerformance}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {lap.laptopSpecs?.teachingDurability}
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      <div className="text-lg font-extrabold text-sky-400">
                        {formatCop(lap.priceAllMethods)}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Todo medio de pago (PSE)
                      </div>
                      {lap.storeCrossedPrice && (
                        <div className="text-[11px] text-slate-500 line-through">
                          Antes tienda: {formatCop(lap.storeCrossedPrice)} (-
                          {lap.storeClaimedDiscountPct}%)
                        </div>
                      )}
                      {lap.priceCardSpecial && (
                        <div className="mt-1 rounded bg-slate-800 px-2 py-0.5 text-[11px] text-amber-300">
                          {lap.cardName}: {formatCop(lap.priceCardSpecial)}
                        </div>
                      )}
                    </td>

                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold ${
                          lap.authenticity === "caza_mayor"
                            ? "bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/40"
                            : lap.authenticity === "verified_real_deal"
                            ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                            : lap.authenticity === "inflated_fake_discount"
                            ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
                            : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {lap.authenticityLabel}
                      </span>
                      <div className="mt-1 text-xs text-slate-300 font-medium">
                        Valor real por specs:{" "}
                        {formatCop(lap.historicalBaselinePrice)}
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400 md:max-w-xs">
                        {lap.authenticityReason}
                      </p>
                    </td>

                    <td className="py-4 px-4 md:text-right">
                      <a
                        href={lap.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="touch-target inline-flex w-full md:w-auto justify-center items-center gap-1 rounded-lg bg-slate-800 px-3 py-2.5 text-xs font-bold text-sky-300 transition hover:bg-sky-400 hover:text-slate-950"
                      >
                        Ver Portátil
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* SECCIÓN 3: CENTRO DE NOTIFICACIONES REALES (SIN SPAM) */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Bell className="h-5 w-5 text-amber-400" />
                3. Alertas Disparadas en este Barrido (Correo / WhatsApp)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Solo se envían alertas a WhatsApp cuando hay una{" "}
                <strong className="text-emerald-300">
                  rebaja real verificada de al menos $300.000 COP
                </strong>{" "}
                o cuando un portátil de gama superior cae al rango de{" "}
                <strong className="text-sky-300">&le; $2.950.000 COP</strong>{" "}
                (y no vuelve a repetir aviso salvo que baje otros $300.000 COP).
              </p>
            </div>

            <button
              type="button"
              onClick={copySummaryToClipboard}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/20"
            >
              {copiedWhatsApp ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ¡Resumen Copiado para WhatsApp!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copiar Resumen para Enviar por WhatsApp
                </>
              )}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {alerts.map((al) => (
              <div
                key={al.id}
                className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                    <span className="font-bold text-emerald-400">
                      -{al.realDiscountPct}% REAL
                    </span>
                    <span>{al.storeName}</span>
                  </div>
                  <h3 className="mt-1.5 text-sm font-bold text-white">
                    {al.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-300">{al.message}</p>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-sm font-extrabold text-white">
                    {formatCop(al.priceAllMethods)}
                  </span>
                  <a
                    href={al.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-sky-400 hover:underline inline-flex items-center gap-1"
                  >
                    Abrir oferta <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

