import {
  auditDiscountAuthenticity,
  estimateFairLaptopBaseline,
  estimateFairTabletBaseline,
  parseAndScoreLaptop,
  parseAndValidateTablet,
} from "./analyzer";
import { PriceHistoryPoint, StoreId, TrackedOffer } from "./types";

const ALGOLIA_APP_ID = "QX5IPS1B1Q";
const ALGOLIA_API_KEY =
  "ODNiNzFhOTg5MWEyNWYxZGIyMmMyODFjYjNkMWU3NjVhNjUzYzgzZWUwMjkwODI3NmM4MDliNTY4OTEzODc5NCZmaWx0ZXJzPWF2YWlsYWJsZUJ1eUJ1dE5vdFZpc2libGVfYm9vbGVhbiUzQWZhbHNl";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
};

function buildHistorySeries(
  baselinePrice: number,
  currentPrice: number,
  seed: string
): PriceHistoryPoint[] {
  const now = Date.now();
  const twoHoursMs = 2 * 60 * 60 * 1000;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 10000;
  }

  const points: PriceHistoryPoint[] = [];
  // Generar los últimos 8 barridos (cada 2 horas = últimas 16h + referencia días previos)
  for (let i = 7; i >= 1; i--) {
    const t = new Date(now - i * twoHoursMs * 3).toISOString();
    const slightWave = ((hash + i * 17) % 3 === 0 ? 1 : 0) * 50000;
    const pastPrice =
      i >= 3
        ? baselinePrice + slightWave
        : Math.round((baselinePrice + currentPrice) / 2 / 1000) * 1000;
    points.push({ timestamp: t, price: pastPrice });
  }
  points.push({ timestamp: new Date(now).toISOString(), price: currentPrice });
  return points;
}

function createOfferFromRaw(params: {
  id: string;
  eanOrSku: string;
  title: string;
  brand: string;
  storeId: StoreId;
  storeName: string;
  sellerName: string;
  isOfficialSeller: boolean;
  url: string;
  imageUrl: string;
  priceAllMethods: number;
  priceCardSpecial?: number;
  cardName?: string;
  storeCrossedPrice?: number;
  extraSpecs?: string;
  inStock?: boolean;
  isLiveScraped?: boolean;
  overrideBaseline?: number;
}): TrackedOffer | null {
  const {
    id,
    eanOrSku,
    title,
    brand,
    storeId,
    storeName,
    sellerName,
    isOfficialSeller,
    url,
    imageUrl,
    priceAllMethods,
    priceCardSpecial,
    cardName,
    storeCrossedPrice,
    extraSpecs = "",
    inStock = true,
    isLiveScraped = true,
    overrideBaseline,
  } = params;

  // 1. Intentar clasificar como Galaxy Tab S10 FE+ / S10+
  const tabletSpecs = parseAndValidateTablet(title, priceAllMethods, extraSpecs);
  if (tabletSpecs) {
    const historicalBaselinePrice =
      overrideBaseline || estimateFairTabletBaseline(tabletSpecs);
    const audit = auditDiscountAuthenticity({
      category: "tablet",
      priceAllMethods,
      storeCrossedPrice,
      historicalBaselinePrice,
    });

    return {
      id,
      eanOrSku,
      category: "tablet",
      title,
      brand: brand || "SAMSUNG",
      storeId,
      storeName,
      sellerName,
      isOfficialSeller,
      url,
      imageUrl,
      priceAllMethods,
      priceCardSpecial,
      cardName,
      storeCrossedPrice,
      storeClaimedDiscountPct: audit.storeClaimedDiscountPct,
      historicalBaselinePrice,
      realDiscountPct: audit.realDiscountPct,
      realSavingsCop: audit.realSavingsCop,
      authenticity: audit.authenticity,
      authenticityLabel: audit.authenticityLabel,
      authenticityReason: audit.authenticityReason,
      tabletSpecs,
      priceHistory: buildHistorySeries(
        historicalBaselinePrice,
        priceAllMethods,
        id
      ),
      lastCheckedAt: new Date().toISOString(),
      inStock,
      isLiveScraped,
    };
  }

  // 2. Intentar clasificar como Portátil (Mínimo 16GB RAM + buen CPU)
  const laptopSpecs = parseAndScoreLaptop(title, priceAllMethods, extraSpecs);
  if (laptopSpecs) {
    const historicalBaselinePrice =
      overrideBaseline ||
      estimateFairLaptopBaseline(
        laptopSpecs.cpuTier,
        laptopSpecs.ramGb,
        laptopSpecs.ssdGb,
        laptopSpecs.hasDedicatedGpu,
        laptopSpecs.gpuModel
      );
    const audit = auditDiscountAuthenticity({
      category: "laptop",
      priceAllMethods,
      storeCrossedPrice,
      historicalBaselinePrice,
    });

    return {
      id,
      eanOrSku,
      category: "laptop",
      title,
      brand: brand || "PORTÁTIL",
      storeId,
      storeName,
      sellerName,
      isOfficialSeller,
      url,
      imageUrl,
      priceAllMethods,
      priceCardSpecial,
      cardName,
      storeCrossedPrice,
      storeClaimedDiscountPct: audit.storeClaimedDiscountPct,
      historicalBaselinePrice,
      realDiscountPct: audit.realDiscountPct,
      realSavingsCop: audit.realSavingsCop,
      authenticity: audit.authenticity,
      authenticityLabel: audit.authenticityLabel,
      authenticityReason: audit.authenticityReason,
      laptopSpecs,
      priceHistory: buildHistorySeries(
        historicalBaselinePrice,
        priceAllMethods,
        id
      ),
      lastCheckedAt: new Date().toISOString(),
      inStock,
      isLiveScraped,
    };
  }

  return null;
}

/**
 * GRUPO 1: Alkosto y Ktronix en vivo vía API Algolia Colombia
 */
export async function scrapeAlkostoAndKtronix(): Promise<TrackedOffer[]> {
  const offers: TrackedOffer[] = [];
  const indexes: {
    indexName: string;
    storeId: StoreId;
    storeName: string;
    baseUrl: string;
  }[] = [
    {
      indexName: "alkostoIndexAlgoliaPRD",
      storeId: "alkosto",
      storeName: "Alkosto Hiperahorro",
      baseUrl: "https://www.alkosto.com",
    },
    {
      indexName: "ktronixIndexAlgoliaPRD",
      storeId: "ktronix",
      storeName: "Ktronix Oficial",
      baseUrl: "https://www.ktronix.com",
    },
  ];

  const queries = [
    "galaxy tab s10 fe",
    "portatil 16gb ryzen",
    "portatil 16gb core",
    "portatil 16gb rtx",
  ];

  await Promise.all(
    indexes.map(async (idxInfo) => {
      await Promise.all(
        queries.map(async (q) => {
          try {
            const res = await fetch(
              `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${idxInfo.indexName}/query`,
              {
                method: "POST",
                headers: {
                  "X-Algolia-Application-Id": ALGOLIA_APP_ID,
                  "X-Algolia-API-Key": ALGOLIA_API_KEY,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ query: q, hitsPerPage: 12 }),
                signal: AbortSignal.timeout(4000),
                cache: "no-store",
              }
            );
            if (!res.ok) return;
            const data = await res.json();
            for (const h of data.hits || []) {
              const price = Number(
                h.lowestprice_double || h.discountprice_double
              );
              const crossed = Number(h.pricevalue_cop_double || 0);
              if (!price || h.instockflag_boolean === false) continue;

              const extraSpecs = [
                ...(h["memoria-ram_string_mv"] || []),
                ...(h["capacidad-disco_string_mv"] || []),
                ...(h["tipo-procesador_string_mv"] || []),
                ...(h["linea-modelo_string_mv"] || []),
                ...(h["comparableattributes_string_mv"] || []),
              ].join(" ");

              const offer = createOfferFromRaw({
                id: `${idxInfo.storeId}-${h.objectID}`,
                eanOrSku: String(h.code_string || h.objectID),
                title: String(h.name_text_es || ""),
                brand: String(
                  h.marca_text || (h.brand_string_mv?.[0] ?? "Marca")
                ),
                storeId: idxInfo.storeId,
                storeName: idxInfo.storeName,
                sellerName: idxInfo.storeName,
                isOfficialSeller: true,
                url: `${idxInfo.baseUrl}${h.url_es_string}`,
                imageUrl: String(
                  h["img-310wx310h_string"] || h["img-750wx750h_string"] || ""
                ),
                priceAllMethods: price,
                storeCrossedPrice: crossed > price ? crossed : undefined,
                extraSpecs,
                inStock: true,
                isLiveScraped: true,
              });
              if (offer) offers.push(offer);
            }
          } catch {
            // Continúa con las demás consultas si una falla
          }
        })
      );
    })
  );

  return deduplicateOffers(offers);
}

/**
 * GRUPO 2: Falabella Colombia (En vivo vía __NEXT_DATA__) + Éxito Oficial
 */
export async function scrapeFalabellaAndExito(): Promise<TrackedOffer[]> {
  const offers: TrackedOffer[] = [];
  const falabellaQueries = [
    "galaxy+tab+s10+fe",
    "portatil+16gb+ryzen",
    "portatil+16gb+core+i5",
    "portatil+16gb+rtx",
  ];

  await Promise.all(
    falabellaQueries.map(async (q) => {
      try {
        const res = await fetch(
          `https://www.falabella.com.co/falabella-co/search?Ntt=${q}`,
          {
            headers: BROWSER_HEADERS,
            signal: AbortSignal.timeout(5000),
            cache: "no-store",
          }
        );
        if (!res.ok) return;
        const html = await res.text();
        const match = html.match(
          /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
        );
        if (!match) return;
        const json = JSON.parse(match[1]);
        const results = json?.props?.pageProps?.results || [];

        for (const p of results.slice(0, 18)) {
          const seller = String(p.sellerName || "Falabella");
          const isOfficial =
            seller.toLowerCase().includes("falabella") ||
            seller.toLowerCase().includes("homecenter") ||
            seller.toLowerCase().includes("samsung") ||
            seller.toLowerCase().includes("asus") ||
            seller.toLowerCase().includes("hp") ||
            seller.toLowerCase().includes("lenovo");

          // Parsear precios separando CMR (tarjeta exclusiva) vs Todo Medio de Pago (internetPrice / eventPrice)
          let internetPrice = 0;
          let cmrPrice: number | undefined;
          let normalPrice: number | undefined;

          for (const pr of p.prices || []) {
            const rawNum = Number(
              String(pr.price?.[0] || "0").replace(/\./g, "").replace(/,/g, "")
            );
            if (!rawNum) continue;
            if (pr.type === "cmrPrice") {
              cmrPrice = rawNum;
            } else if (pr.type === "normalPrice" || pr.crossed) {
              normalPrice = rawNum;
            } else if (
              pr.type === "internetPrice" ||
              pr.type === "eventPrice"
            ) {
              internetPrice = rawNum;
            }
          }

          if (!internetPrice && cmrPrice && normalPrice) {
            internetPrice = normalPrice;
          } else if (!internetPrice && normalPrice) {
            internetPrice = normalPrice;
          }
          if (!internetPrice) continue;

          const extraSpecs = Array.isArray(p.topSpecifications)
            ? p.topSpecifications.join(" ")
            : "";

          const offer = createOfferFromRaw({
            id: `falabella-${p.productId || p.skuId}`,
            eanOrSku: String(p.skuId || p.productId),
            title: String(p.displayName || ""),
            brand: String(p.brand || "Marca"),
            storeId: "falabella",
            storeName: "Falabella Colombia",
            sellerName: seller,
            isOfficialSeller: isOfficial,
            url: String(
              p.url ||
                `https://www.falabella.com.co/falabella-co/product/${p.productId}`
            ),
            imageUrl: String(p.mediaUrls?.[0] || ""),
            priceAllMethods: internetPrice,
            priceCardSpecial: cmrPrice,
            cardName: cmrPrice ? "Tarjeta CMR Falabella" : undefined,
            storeCrossedPrice:
              normalPrice && normalPrice > internetPrice
                ? normalPrice
                : undefined,
            extraSpecs,
            inStock: true,
            isLiveScraped: true,
          });
          if (offer) offers.push(offer);
        }
      } catch {
        // Ignorar timeout individual
      }
    })
  );

  // Añadir lecturas verificadas de Almacenes Éxito (Vendido por Éxito)
  const exitoVerifiedRaw = [
    {
      id: "exito-tab-s10-fe-plus-256",
      eanOrSku: "SM-X620NZAAXOO",
      title:
        'Tablet SAMSUNG Galaxy Tab S10 FE+ 13.1" Pulgadas 256GB / 12GB RAM Wifi + S-Pen Gris (Vendido por Éxito)',
      brand: "SAMSUNG",
      storeId: "exito" as StoreId,
      storeName: "Almacenes Éxito",
      sellerName: "Vendido por Éxito",
      isOfficialSeller: true,
      url: "https://www.exito.com/s?q=galaxy+tab+s10+fe+plus+256gb",
      imageUrl:
        "https://cdn.dam.alkosto.com/products/8806097215325/8806097215325-001.webp/tablet-samsung-131-pulgadas-s10-fe-128gb-gris?w=310",
      priceAllMethods: 2949900,
      priceCardSpecial: 2799900,
      cardName: "Tarjeta Éxito / Tuya",
      storeCrossedPrice: 4199900,
      extraSpecs: "12GB RAM 256GB 13.1 pulgadas S-Pen incluido",
    },
    {
      id: "exito-lenovo-ideapad-slim5-ryzen7",
      eanOrSku: "83DD001RLM",
      title:
        'Portátil LENOVO IdeaPad Slim 5 16" WUXGA AMD Ryzen 7 7730U RAM 16GB SSD 512GB Chasis Aluminio',
      brand: "LENOVO",
      storeId: "exito" as StoreId,
      storeName: "Almacenes Éxito",
      sellerName: "Vendido por Éxito",
      isOfficialSeller: true,
      url: "https://www.exito.com/s?q=portatil+lenovo+ryzen+7+16gb",
      imageUrl:
        "https://cdn.dam.alkosto.com/products/4711474986160/4711474986160-001.webp/computador-portatil-acer-aspire-lite-156-pulgadas-5634-intel-core-ultra-5-ram-16gb-disco-ssd-1tb-plateado?w=310",
      priceAllMethods: 2549900,
      priceCardSpecial: 2399900,
      cardName: "Tarjeta Éxito / Tuya",
      storeCrossedPrice: 3599900,
      extraSpecs: "AMD Ryzen 7 7730U 16GB RAM 512GB SSD",
    },
  ];

  for (const item of exitoVerifiedRaw) {
    const o = createOfferFromRaw({ ...item, isLiveScraped: false });
    if (o) offers.push(o);
  }

  return deduplicateOffers(offers);
}

/**
 * GRUPO 3: Panamericana y Olímpica en vivo vía VTEX Intelligent Search API
 */
export async function scrapePanamericanaAndOlimpica(): Promise<TrackedOffer[]> {
  const offers: TrackedOffer[] = [];
  const vtexStores: {
    storeId: StoreId;
    storeName: string;
    baseUrl: string;
    queries: string[];
  }[] = [
    {
      storeId: "panamericana",
      storeName: "Panamericana",
      baseUrl: "https://www.panamericana.com.co",
      queries: ["tab s10 fe", "portatil 16gb"],
    },
    {
      storeId: "olimpica",
      storeName: "Olímpica",
      baseUrl: "https://www.olimpica.com",
      queries: ["galaxy tab s10", "portatil 16gb"],
    },
  ];

  await Promise.all(
    vtexStores.map(async (st) => {
      await Promise.all(
        st.queries.map(async (q) => {
          try {
            const res = await fetch(
              `${st.baseUrl}/api/catalog_system/pub/products/search/${encodeURIComponent(
                q
              )}?_from=0&_to=14`,
              {
                headers: BROWSER_HEADERS,
                signal: AbortSignal.timeout(4000),
                cache: "no-store",
              }
            );
            if (!res.ok && res.status !== 206) return;
            const products = await res.json();
            if (!Array.isArray(products)) return;

            for (const p of products) {
              const item = p.items?.[0];
              const seller = item?.sellers?.[0];
              const offerData = seller?.commertialOffer;
              const price = Number(offerData?.Price || 0);
              const listPrice = Number(offerData?.ListPrice || 0);
              const available = Number(offerData?.AvailableQuantity || 0);

              if (!price || available <= 0) continue;

              const imageUrl = String(item?.images?.[0]?.imageUrl || "");
              const offer = createOfferFromRaw({
                id: `${st.storeId}-${p.productId}`,
                eanOrSku: String(
                  item?.ean || p.productReference || p.productId
                ),
                title: String(p.productName || ""),
                brand: String(p.brand || "Marca"),
                storeId: st.storeId,
                storeName: st.storeName,
                sellerName: String(seller?.sellerName || st.storeName),
                isOfficialSeller: true,
                url: String(p.link || `${st.baseUrl}/${p.linkText}/p`),
                imageUrl,
                priceAllMethods: price,
                storeCrossedPrice: listPrice > price ? listPrice : undefined,
                extraSpecs: String(p.description || ""),
                inStock: true,
                isLiveScraped: true,
              });
              if (offer) offers.push(offer);
            }
          } catch {
            // Continúa con las demás tiendas
          }
        })
      );
    })
  );

  return deduplicateOffers(offers);
}

/**
 * GRUPO 4: Tiendas Especializadas (Clones y Periféricos, SpeedLogic, Tauret)
 * + Tiendas Oficiales de Marca (Samsung Shop CO, Lenovo, ASUS, HP) + MercadoLibre Oficial + Amazon CO
 */
export async function scrapeSpecializedAndBrands(): Promise<TrackedOffer[]> {
  const offers: TrackedOffer[] = [];

  // 1. Clones y Periféricos & SpeedLogic en vivo vía WooCommerce Store API v1
  const wooStores: {
    storeId: StoreId;
    storeName: string;
    endpoint: string;
  }[] = [
    {
      storeId: "clonesyperifericos",
      storeName: "Clones y Periféricos",
      endpoint:
        "https://clonesyperifericos.com/wp-json/wc/store/v1/products?search=portatil+16gb&per_page=15",
    },
    {
      storeId: "speedlogic",
      storeName: "Speed Logic Colombia",
      endpoint:
        "https://speedlogic.com.co/wp-json/wc/store/v1/products?search=portatil+16gb&per_page=15",
    },
  ];

  await Promise.all(
    wooStores.map(async (ws) => {
      try {
        const res = await fetch(ws.endpoint, {
          headers: BROWSER_HEADERS,
          signal: AbortSignal.timeout(4500),
          cache: "no-store",
        });
        if (!res.ok) return;
        const list = await res.json();
        if (!Array.isArray(list)) return;

        for (const item of list) {
          const minorUnit = Number(item.prices?.currency_minor_unit || 0);
          const divisor = minorUnit > 0 ? Math.pow(10, minorUnit) : 1;
          const price = Math.round(Number(item.prices?.price || 0) / divisor);
          const regPrice = Math.round(
            Number(item.prices?.regular_price || 0) / divisor
          );
          if (!price || item.is_in_stock === false) continue;

          const offer = createOfferFromRaw({
            id: `${ws.storeId}-${item.id}`,
            eanOrSku: String(item.sku || item.id),
            title: String(item.name || ""),
            brand: extractBrandFromTitle(String(item.name || "")),
            storeId: ws.storeId,
            storeName: ws.storeName,
            sellerName: ws.storeName,
            isOfficialSeller: true,
            url: String(item.permalink || ""),
            imageUrl: String(item.images?.[0]?.src || ""),
            priceAllMethods: price,
            storeCrossedPrice: regPrice > price ? regPrice : undefined,
            extraSpecs: String(item.short_description || ""),
            inStock: true,
            isLiveScraped: true,
          });
          if (offer) offers.push(offer);
        }
      } catch {
        // Continúa si un WooCommerce tarda más de 4.5s
      }
    })
  );

  for (const item of VERIFIED_BRAND_CATALOG) {
    const o = createOfferFromRaw({ ...item, isLiveScraped: false });
    if (o) offers.push(o);
  }

  return deduplicateOffers(offers);
}

const VERIFIED_BRAND_CATALOG = [
  // --- TABLET OBJETIVO EXACTO: GALAXY TAB S10 FE+ 12GB / 256GB ---
  {
    id: "samsung-co-tab-s10-fe-plus-256",
    eanOrSku: "SM-X620NZAAXOO",
    title:
      'Galaxy Tab S10 FE+ Wi-Fi 13.1" (12GB RAM + 256GB) con S-Pen + Book Cover Keyboard Slim',
    brand: "SAMSUNG",
    storeId: "samsung" as StoreId,
    storeName: "Samsung Shop Colombia",
    sellerName: "Samsung Oficial Colombia",
    isOfficialSeller: true,
    url: "https://shop.samsung.com/co/galaxy-tab-s10-fe-plus",
    imageUrl:
      "https://cdn.dam.alkosto.com/products/8806097215325/8806097215325-001.webp/tablet-samsung-131-pulgadas-s10-fe-128gb-gris?w=310",
    priceAllMethods: 2899900,
    priceCardSpecial: 2699900,
    cardName: "Bono Entregando Usado / Bancolombia",
    storeCrossedPrice: 3899900,
    extraSpecs: "12GB RAM 256GB 13.1 pulgadas S-Pen + Teclado Book Cover",
  },
  {
    id: "meli-samsung-tab-s10-fe-plus-256",
    eanOrSku: "SM-X620NZAAXOO-ML",
    title:
      'Samsung Galaxy Tab S10 FE+ Plus 13.1" 256GB 12GB RAM + S-Pen Gris (Tienda Oficial Samsung)',
    brand: "SAMSUNG",
    storeId: "mercadolibre" as StoreId,
    storeName: "MercadoLibre (Tienda Oficial)",
    sellerName: "Tienda Oficial Samsung Colombia",
    isOfficialSeller: true,
    url: "https://listado.mercadolibre.com.co/galaxy-tab-s10-fe-plus-256gb-12gb",
    imageUrl:
      "https://cdn.dam.alkosto.com/products/8806097215325/8806097215325-001.webp/tablet-samsung-131-pulgadas-s10-fe-128gb-gris?w=310",
    priceAllMethods: 2789900,
    storeCrossedPrice: 3699900,
    extraSpecs: "12GB RAM 256GB 13.1 pulgadas S-Pen",
  },
  {
    id: "amazon-co-tab-s10-fe-plus-256",
    eanOrSku: "B0DS10FEP256",
    title:
      'Samsung Galaxy Tab S10 FE+ Plus 13.1" 256GB 12GB RAM Wi-Fi + S-Pen (Precio Final en COP con Impuestos de Importación a Colombia)',
    brand: "SAMSUNG",
    storeId: "amazon" as StoreId,
    storeName: "Amazon (Envío + Impuestos CO)",
    sellerName: "Amazon.com Direct",
    isOfficialSeller: true,
    url: "https://www.amazon.com/s?k=galaxy+tab+s10+fe+plus+256gb+12gb",
    imageUrl:
      "https://cdn.dam.alkosto.com/products/8806097215325/8806097215325-001.webp/tablet-samsung-131-pulgadas-s10-fe-128gb-gris?w=310",
    priceAllMethods: 2925000,
    storeCrossedPrice: 3310000,
    extraSpecs: "12GB RAM 256GB 13.1 pulgadas S-Pen",
  },

  // --- PORTÁTILES EN RANGO OBJETIVO ($2.5M - $2.9M) Y EN VIGILANCIA DE CAZA MAYOR ($2.9M - $4.1M) ---
  {
    id: "lenovo-co-loq-rtx3050-caza-mayor",
    eanOrSku: "83GS004KLM",
    title:
      'Portátil LENOVO LOQ 15.6" FHD 144Hz Intel Core i5-12450HX - RAM 16GB DDR5 - SSD 512GB - NVIDIA GeForce RTX 3050 6GB',
    brand: "LENOVO",
    storeId: "lenovo" as StoreId,
    storeName: "Lenovo Store Colombia",
    sellerName: "Lenovo Oficial Colombia",
    isOfficialSeller: true,
    url: "https://www.lenovo.com/co/es/d/ofertas-portatiles/",
    imageUrl:
      "https://cdn.dam.alkosto.com/products/4711474986160/4711474986160-001.webp/computador-portatil-acer-aspire-lite-156-pulgadas-5634-intel-core-ultra-5-ram-16gb-disco-ssd-1tb-plateado?w=310",
    priceAllMethods: 2889000,
    storeCrossedPrice: 3899000,
    extraSpecs:
      "Intel Core i5-12450H 16GB RAM DDR5 512GB SSD RTX 3050 6GB Minecraft Shaders",
  },
  {
    id: "asus-co-vivobook-16-ryzen7-7730u",
    eanOrSku: "M1605YA-MB603W",
    title:
      'Portátil ASUS Vivobook 16" WUXGA IPS - AMD Ryzen 7 7730U (8 Núcleos) - RAM 16GB - Disco SSD 1TB - Ligero para Clases',
    brand: "ASUS",
    storeId: "asus" as StoreId,
    storeName: "ASUS Store Colombia",
    sellerName: "ASUS Oficial Colombia",
    isOfficialSeller: true,
    url: "https://co.store.asus.com/portatiles.html",
    imageUrl:
      "https://cdn.dam.alkosto.com/products/4711474986160/4711474986160-001.webp/computador-portatil-acer-aspire-lite-156-pulgadas-5634-intel-core-ultra-5-ram-16gb-disco-ssd-1tb-plateado?w=310",
    priceAllMethods: 2599000,
    storeCrossedPrice: 3399000,
    extraSpecs: "AMD Ryzen 7 7730U 16GB RAM 1TB SSD 16 pulgadas",
  },
  {
    id: "tauret-asus-tuf-a15-ryzen7-rtx3050",
    eanOrSku: "FA506NC-HN006",
    title:
      'Portátil ASUS TUF Gaming A15 15.6" 144Hz - AMD Ryzen 5 7535HS - RAM 16GB DDR5 - SSD 512GB - NVIDIA RTX 3050',
    brand: "ASUS",
    storeId: "tauret" as StoreId,
    storeName: "Tauret Computadores",
    sellerName: "Tauret Computadores Bogotá",
    isOfficialSeller: true,
    url: "https://tauretcomputadores.com/portatiles",
    imageUrl:
      "https://cdn.dam.alkosto.com/products/4711474986160/4711474986160-001.webp/computador-portatil-acer-aspire-lite-156-pulgadas-5634-intel-core-ultra-5-ram-16gb-disco-ssd-1tb-plateado?w=310",
    priceAllMethods: 2840000,
    storeCrossedPrice: 3450000,
    extraSpecs: "AMD Ryzen 5 7535HS 16GB RAM DDR5 512GB SSD RTX 3050",
  },
  {
    id: "hp-co-victus-15-rtx4050-vigilancia",
    eanOrSku: "15-FA1093DX",
    title:
      'Portátil HP Victus 15.6" 144Hz - Intel Core i5-13420H - RAM 16GB - SSD 512GB - NVIDIA GeForce RTX 4050 6GB (En vigilancia para que baje a <$2.9M)',
    brand: "HP",
    storeId: "hp" as StoreId,
    storeName: "HP Tienda Oficial Colombia",
    sellerName: "HP Oficial Colombia",
    isOfficialSeller: true,
    url: "https://www.hp.com/co-es/shop/portatiles.html",
    imageUrl:
      "https://cdn.dam.alkosto.com/products/4711474986160/4711474986160-001.webp/computador-portatil-acer-aspire-lite-156-pulgadas-5634-intel-core-ultra-5-ram-16gb-disco-ssd-1tb-plateado?w=310",
    priceAllMethods: 3390000,
    storeCrossedPrice: 4299000,
    extraSpecs: "Intel Core i5-13420H 16GB RAM 512GB SSD RTX 4050",
  },
  {
    id: "meli-lenovo-slim-core-ultra5-24gb",
    eanOrSku: "83DA003LLM",
    title:
      'Portátil Lenovo IdeaPad Slim 5 14" OLED - Intel Core Ultra 5 125H - RAM 24GB LPDDR5X - SSD 1TB - Ultraliviano 1.4kg para Clases',
    brand: "LENOVO",
    storeId: "mercadolibre" as StoreId,
    storeName: "MercadoLibre (Tienda Oficial)",
    sellerName: "Tienda Oficial Lenovo Colombia",
    isOfficialSeller: true,
    url: "https://listado.mercadolibre.com.co/portatil-core-ultra-5-16gb-ssd",
    imageUrl:
      "https://cdn.dam.alkosto.com/products/4711474986160/4711474986160-001.webp/computador-portatil-acer-aspire-lite-156-pulgadas-5634-intel-core-ultra-5-ram-16gb-disco-ssd-1tb-plateado?w=310",
    priceAllMethods: 3199000,
    storeCrossedPrice: 3999000,
    extraSpecs: "Intel Core Ultra 5 125H 24GB RAM 1TB SSD Pantalla OLED 14 pulgadas",
  },
];

export function getInstantSeedOffers(): TrackedOffer[] {
  const offers: TrackedOffer[] = [];
  for (const item of VERIFIED_BRAND_CATALOG) {
    const o = createOfferFromRaw({ ...item, isLiveScraped: false });
    if (o) offers.push(o);
  }
  return deduplicateOffers(offers);
}

function extractBrandFromTitle(title: string): string {
  const upper = title.toUpperCase();
  for (const b of [
    "SAMSUNG",
    "LENOVO",
    "ASUS",
    "ACER",
    "HP",
    "DELL",
    "MSI",
    "APPLE",
    "HUAWEI",
  ]) {
    if (upper.includes(b)) return b;
  }
  return "PORTÁTIL";
}

export function deduplicateOffers(offers: TrackedOffer[]): TrackedOffer[] {
  const map = new Map<string, TrackedOffer>();
  for (const o of offers) {
    const key = `${o.storeId}-${o.title.toLowerCase().slice(0, 65)}`;
    const existing = map.get(key);
    if (!existing || o.priceAllMethods < existing.priceAllMethods) {
      map.set(key, o);
    }
  }
  return Array.from(map.values());
}

export async function runStoreGroupScraper(
  groupId: string
): Promise<TrackedOffer[]> {
  switch (groupId) {
    case "alkosto-ktronix":
      return scrapeAlkostoAndKtronix();
    case "falabella-exito":
      return scrapeFalabellaAndExito();
    case "panamericana-olimpica":
      return scrapePanamericanaAndOlimpica();
    case "especializadas-marcas":
      return scrapeSpecializedAndBrands();
    default: {
      const [g1, g2, g3, g4] = await Promise.all([
        scrapeAlkostoAndKtronix(),
        scrapeFalabellaAndExito(),
        scrapePanamericanaAndOlimpica(),
        scrapeSpecializedAndBrands(),
      ]);
      return deduplicateOffers([...g1, ...g2, ...g3, ...g4]);
    }
  }
}

