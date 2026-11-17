import {
  DiscountAuthenticity,
  LaptopSpecs,
  TabletSpecs,
} from "./types";

const TABLET_ACCESSORY_BLACKLIST = [
  "funda",
  "estuche",
  "forro",
  "vidrio",
  "protector",
  "paper like",
  "paperlike",
  "cargador",
  "cable",
  "adaptador",
  "soporte",
  "base",
  "repuesto",
  "puntas",
  "celular",
  "smartphone",
  "galaxy s24",
  "galaxy s25",
  "galaxy s26",
  "tab a9",
  "tab a11",
  "tab a8",
  "tab s6",
  "tab s10 lite",
  "s10lite",
];

const LAPTOP_BLACKLIST = [
  "memoria para",
  "memoria ram ddr",
  "base refrigerante",
  "funda",
  "morral",
  "maletin",
  "cargador",
  "bateria para",
  "pantalla para portatil",
  "teclado para portatil",
  "disco solido",
  "ssd externo",
  "monitor",
  "all in one",
  "todo en uno",
  "aio ",
  "torre ",
  "pc escritorio",
  "tablet",
  "ipad",
  "impresora",
  "reacondicionado",
  "usado",
  "open box",
];

/**
 * Analiza si un producto corresponde a la familia Galaxy Tab S10 FE+ / S10+
 * y clasifica con precisión si es la versión exacta de 12GB RAM y 256GB.
 */
export function parseAndValidateTablet(
  rawTitle: string,
  priceAllMethods: number,
  extraDescription = ""
): TabletSpecs | null {
  const full = `${rawTitle} ${extraDescription}`.toLowerCase();

  if (priceAllMethods < 1450000 || priceAllMethods > 5800000) {
    return null;
  }

  for (const bad of TABLET_ACCESSORY_BLACKLIST) {
    if (full.includes(bad)) {
      // Excepción: cuando la tablet incluye funda/teclado original en combo ("+ teclado" o "con funda")
      const isCombo =
        (bad === "funda" || bad === "estuche") &&
        (full.includes("tablet") || full.includes("galaxy tab")) &&
        priceAllMethods > 1700000;
      if (!isCombo) return null;
    }
  }

  const hasTabS10 =
    full.includes("tab s10") ||
    full.includes("tabs10") ||
    (full.includes("s10 fe") && full.includes("tablet"));

  if (!hasTabS10) return null;

  const isFE = full.includes("fe");
  const hasPlusIndicator =
    full.includes("fe+") ||
    full.includes("fe +") ||
    full.includes("fe plus") ||
    full.includes("s10+") ||
    full.includes("s10 plus") ||
    full.includes("13.1") ||
    full.includes("13,1") ||
    full.includes("12.4") ||
    full.includes("12,4");

  const has256 = full.includes("256gb") || full.includes("256 gb");
  const has128 = full.includes("128gb") || full.includes("128 gb");
  const has12Ram =
    full.includes("12gb") ||
    full.includes("12 gb") ||
    full.includes("12 ram") ||
    (has256 && hasPlusIndicator); // En Samsung CO la versión 256GB de S10 FE+ / S10+ viene con 12GB RAM

  const includesKeyboard =
    full.includes("teclado") ||
    full.includes("keyboard") ||
    full.includes("book cover");
  const includesSPen =
    full.includes("s pen") ||
    full.includes("s-pen") ||
    full.includes("spen") ||
    full.includes("lápiz") ||
    full.includes("lapiz") ||
    true; // Todas las Galaxy Tab S10 FE / FE+ nuevas incluyen S-Pen en caja

  if (isFE && has256 && (has12Ram || hasPlusIndicator)) {
    return {
      isExactTarget: true,
      modelVariant: "S10 FE+ 12GB / 256GB (Objetivo Exacto)",
      ramGb: 12,
      storageGb: 256,
      screenInches: full.includes("13.1") ? '13.1"' : '12.4" / 13.1"',
      includesKeyboard,
      includesSPen,
    };
  }

  if (!isFE && hasPlusIndicator && has256) {
    return {
      isExactTarget: true,
      modelVariant: "S10+ 12GB / 256GB (Gama Alta Dynamic AMOLED)",
      ramGb: 12,
      storageGb: 256,
      screenInches: '12.4"',
      includesKeyboard,
      includesSPen,
    };
  }

  if (isFE && hasPlusIndicator && has128) {
    return {
      isExactTarget: false,
      modelVariant: "S10 FE+ 8GB / 128GB (Variante de 128GB)",
      ramGb: 8,
      storageGb: 128,
      screenInches: '13.1"',
      includesKeyboard,
      includesSPen,
    };
  }

  if (isFE && has128) {
    return {
      isExactTarget: false,
      modelVariant: 'S10 FE 10.9" 8GB / 128GB (Modelo No-Plus)',
      ramGb: 8,
      storageGb: 128,
      screenInches: '10.9"',
      includesKeyboard,
      includesSPen,
    };
  }

  return null;
}

/**
 * Analiza un portátil para evaluar si cumple el perfil para dar clases,
 * durar muchos años sin pegarse y mover Minecraft con fluidez (Mínimo 16GB RAM).
 */
export function parseAndScoreLaptop(
  rawTitle: string,
  priceAllMethods: number,
  extraDescription = ""
): LaptopSpecs | null {
  const full = `${rawTitle} ${extraDescription}`.toLowerCase();

  // Rango de vigilancia amplio: desde 1.9M (por si un PC de 2.7M se desploma) hasta 4.35M (por si uno de 4M baja a <2.9M)
  if (priceAllMethods < 1900000 || priceAllMethods > 4350000) {
    return null;
  }

  for (const bad of LAPTOP_BLACKLIST) {
    if (full.includes(bad)) return null;
  }

  // Descartar procesadores trampa o antiguos
  if (
    full.includes("7520u") ||
    full.includes("7320u") ||
    full.includes("7220u") ||
    full.includes("celeron") ||
    full.includes("pentium") ||
    full.includes("athlon") ||
    full.includes("n100") ||
    full.includes("n200") ||
    full.includes("ryzen 3") ||
    full.includes("core i3")
  ) {
    return null;
  }

  // Extraer RAM (Obligatorio mínimo 16GB)
  let ramGb = 0;
  if (full.includes("32gb") || full.includes("32 gb")) ramGb = 32;
  else if (full.includes("24gb") || full.includes("24 gb")) ramGb = 24;
  else if (
    full.includes("16gb") ||
    full.includes("16 gb") ||
    full.includes("ram 16")
  ) {
    ramGb = 16;
  }

  if (ramGb < 16) {
    return null; // Regla estricta: mínimo 16 GB de RAM para que nunca se le pegue
  }

  // Extraer Almacenamiento SSD
  let ssdGb = 512;
  if (
    full.includes("1tb") ||
    full.includes("1 tb") ||
    full.includes("1000gb") ||
    full.includes("1024gb")
  ) {
    ssdGb = 1024;
  } else if (full.includes("256gb") || full.includes("256 gb")) {
    ssdGb = 256;
  }

  // Clasificar Procesador (Hasta 45 puntos)
  let cpuModel = "Procesador Moderno";
  let cpuTier: "top" | "high" | "mid" | "rejected" = "rejected";
  let cpuPoints = 0;
  const reasons: string[] = [];

  if (
    full.includes("ryzen 7 7735hs") ||
    full.includes("ryzen 7 7840hs") ||
    full.includes("ryzen 7 8840") ||
    full.includes("ryzen 7 8845") ||
    full.includes("ryzen 7 7435hs") ||
    full.includes("core ultra 7") ||
    full.includes("i7-13620h") ||
    full.includes("i7-13700h") ||
    full.includes("i7-14650hx")
  ) {
    cpuModel = extractCpuName(full, "Gama Alta H/HS");
    cpuTier = "top";
    cpuPoints = 45;
    reasons.push("CPU Serie H/HS de alto rendimiento: vuela en Minecraft y multitarea pesada");
  } else if (
    full.includes("core ultra 5") ||
    full.includes("i5-13420h") ||
    full.includes("i5-12450h") ||
    full.includes("i5-13500h") ||
    full.includes("i5-12500h") ||
    full.includes("core 5 210h") ||
    full.includes("ryzen 5 7535hs") ||
    full.includes("ryzen 5 8540u") ||
    full.includes("ryzen 5 7640hs") ||
    full.includes("ryzen 7 5800h") ||
    full.includes("core i7") ||
    full.includes("core 7")
  ) {
    cpuModel = extractCpuName(full, "Alto Rendimiento");
    cpuTier = "top";
    cpuPoints = 41;
    reasons.push("Excelente procesador moderno con sobrada potencia mononúcleo y multinúcleo");
  } else if (
    full.includes("ryzen 7 7730u") ||
    full.includes("ryzen 7 5700u") ||
    full.includes("ryzen 7 5825u") ||
    full.includes("ryzen 7")
  ) {
    cpuModel = extractCpuName(full, "AMD Ryzen 7 (8 Núcleos)");
    cpuTier = "high";
    cpuPoints = 38;
    reasons.push("8 núcleos / 16 hilos eficientes: ideal para dar clases, abrir decenas de pestañas y jugar");
  } else if (
    full.includes("ryzen 5 7530u") ||
    full.includes("ryzen 5 5600h") ||
    full.includes("ryzen 5 5500u") ||
    full.includes("i5-1335u") ||
    full.includes("i5-1334u") ||
    full.includes("i5-1235u") ||
    full.includes("core 5 120u") ||
    full.includes("core 5") ||
    full.includes("core i5") ||
    full.includes("ryzen 5")
  ) {
    cpuModel = extractCpuName(full, "Gama Media-Alta Equilibrada");
    cpuTier = "high";
    cpuPoints = 34;
    reasons.push("Procesador rápido y fresco para varios años de clases y juegos ligeros/medios");
  } else {
    return null;
  }

  // Puntos por RAM + SSD (Hasta 25 puntos)
  let ramSsdPoints = 18;
  if (ramGb >= 24 && ssdGb >= 1024) {
    ramSsdPoints = 25;
    reasons.push(`${ramGb} GB RAM + 1 TB SSD: capacidad máxima para no preocuparse en 6+ años`);
  } else if (ramGb >= 24 || ssdGb >= 1024) {
    ramSsdPoints = 23;
    reasons.push(
      ssdGb >= 1024
        ? `${ramGb} GB RAM + 1 TB SSD NVMe (doble de espacio de lo normal)`
        : `${ramGb} GB RAM de fábrica para fluidez extrema`
    );
  } else if (ssdGb === 512) {
    ramSsdPoints = 19;
    reasons.push("16 GB RAM + 512 GB SSD NVMe rápidos");
  } else {
    ramSsdPoints = 14;
  }

  // Puntos por Gráficos y Portabilidad (Hasta 20 puntos)
  let gpuModel = "Gráficos Integrados Radeon / Intel Iris Xe";
  let hasDedicatedGpu = false;
  let gpuPortabilityPoints = 14;
  let minecraftPerformance: LaptopSpecs["minecraftPerformance"] =
    "Muy Fluido (+100 FPS estable)";

  if (full.includes("rtx 4050") || full.includes("rtx4050")) {
    gpuModel = "NVIDIA GeForce RTX 4050 6GB";
    hasDedicatedGpu = true;
    gpuPortabilityPoints = 20;
    minecraftPerformance = "Ultra Fluido (+140 FPS y Shaders)";
    reasons.push("¡Tiene GPU dedicada RTX 4050! Corre Minecraft con Shaders realistas y cualquier juego actual");
  } else if (full.includes("rtx 3050") || full.includes("rtx3050")) {
    gpuModel = "NVIDIA GeForce RTX 3050";
    hasDedicatedGpu = true;
    gpuPortabilityPoints = 19;
    minecraftPerformance = "Ultra Fluido (+140 FPS y Shaders)";
    reasons.push("¡Incluye tarjeta dedicada RTX 3050! Ideal para jugar con gráficos altos sin esfuerzo");
  } else if (full.includes("rtx 2050") || full.includes("rtx2050")) {
    gpuModel = "NVIDIA GeForce RTX 2050";
    hasDedicatedGpu = true;
    gpuPortabilityPoints = 17;
    minecraftPerformance = "Ultra Fluido (+140 FPS y Shaders)";
    reasons.push("Cuenta con gráfica dedicada NVIDIA RTX 2050 para juegos y aceleración gráfica");
  } else if (
    full.includes("core ultra") ||
    full.includes("7735hs") ||
    full.includes("7535hs") ||
    full.includes("8840") ||
    full.includes("oled")
  ) {
    gpuModel = full.includes("oled")
      ? "Gráficos Integrados Pro + Pantalla OLED"
      : "Gráficos Integrados de Nueva Generación (Arc / Radeon 600M-700M)";
    gpuPortabilityPoints = 16;
    minecraftPerformance = "Muy Fluido (+100 FPS estable)";
    reasons.push("Ultraliviano para llevar a clases con gráficos integrados de nueva generación");
  }

  // Pantalla
  let screenInches = '15.6"';
  if (full.includes("14 ") || full.includes('14"') || full.includes("14 pulgadas")) {
    screenInches = '14" (Ligero para llevar a clases)';
  } else if (full.includes("16 ") || full.includes('16"') || full.includes("16 pulgadas")) {
    screenInches = '16" WUXGA';
  }

  // Puntos de relación Calidad/Precio (Hasta 10 puntos)
  const expectedPrice = estimateFairLaptopBaseline(cpuTier, ramGb, ssdGb, hasDedicatedGpu, gpuModel);
  const diffRatio = (expectedPrice - priceAllMethods) / expectedPrice;
  const dealPoints = Math.max(2, Math.min(10, Math.round(5 + diffRatio * 35)));

  const hardwareScore = Math.min(
    100,
    cpuPoints + ramSsdPoints + gpuPortabilityPoints + dealPoints
  );

  const teachingDurability =
    hardwareScore >= 86
      ? "Sobrado para 5 a 6 años sin trabarse"
      : "Excelente fluidez para 4 a 5 años de uso diario";

  return {
    cpuModel,
    cpuTier,
    ramGb,
    ssdGb,
    gpuModel,
    hasDedicatedGpu,
    screenInches,
    hardwareScore,
    minecraftPerformance,
    teachingDurability,
    scoreBreakdown: {
      cpuPoints,
      ramSsdPoints,
      gpuPortabilityPoints,
      dealPoints,
      reasons,
    },
  };
}

function extractCpuName(text: string, fallback: string): string {
  const patterns: [RegExp, string][] = [
    [/core\s*ultra\s*7\s*([0-9]{3}[a-z]{1,2})?/i, "Intel Core Ultra 7"],
    [/core\s*ultra\s*5\s*([0-9]{3}[a-z]{1,2})?/i, "Intel Core Ultra 5"],
    [/ryzen\s*7\s*(8845hs|8840hs|7840hs|7735hs|7435hs|7730u|5825u|5800h|5700u)/i, "AMD Ryzen 7"],
    [/ryzen\s*5\s*(8540u|7640hs|7535hs|7530u|5600h|5500u)/i, "AMD Ryzen 5"],
    [/i7[\s-]*(14[0-9]{3}[a-z]*|13[0-9]{3}[a-z]*|12[0-9]{3}[a-z]*)/i, "Intel Core i7"],
    [/i5[\s-]*(13420h|12450h|13500h|12500h|1335u|1334u|1235u)/i, "Intel Core i5"],
    [/core\s*7\s*([0-9]{3}[a-z]*)/i, "Intel Core 7"],
    [/core\s*5\s*(210h|120u|[0-9]{3}[a-z]*)/i, "Intel Core 5"],
    [/ryzen\s*7/i, "AMD Ryzen 7"],
    [/ryzen\s*5/i, "AMD Ryzen 5"],
    [/core\s*i7/i, "Intel Core i7"],
    [/core\s*i5/i, "Intel Core i5"],
    [/core\s*5/i, "Intel Core 5"],
  ];

  for (const [regex, label] of patterns) {
    const m = text.match(regex);
    if (m) {
      return m[1] ? `${label} ${m[1].toUpperCase()}` : label;
    }
  }
  return fallback;
}

/**
 * Calcula el precio base real de mercado en Colombia (sin precios inflados de Black Friday)
 * para detectar si un descuento es 100% real o si la tienda infló el precio "Antes".
 */
export function estimateFairLaptopBaseline(
  cpuTier: "top" | "high" | "mid" | "rejected",
  ramGb: number,
  ssdGb: number,
  hasDedicatedGpu: boolean,
  gpuModel: string
): number {
  let base = 2450000;
  if (cpuTier === "top") base = 2850000;
  else if (cpuTier === "high") base = 2550000;

  if (ramGb >= 24) base += 280000;
  if (ssdGb >= 1024) base += 240000;

  if (hasDedicatedGpu) {
    if (gpuModel.includes("4050")) base += 950000;
    else if (gpuModel.includes("3050")) base += 680000;
    else base += 450000;
  }

  return base;
}

export function estimateFairTabletBaseline(tabletSpecs: TabletSpecs): number {
  let base = 3199900; // Precio mediano real en Colombia de la Tab S10 FE+ 12GB/256GB antes de Black Friday
  if (tabletSpecs.modelVariant.includes("S10+ 12GB")) {
    base = 4199900;
  } else if (tabletSpecs.modelVariant.includes("S10 FE+ 8GB / 128GB")) {
    base = 2799900;
  } else if (tabletSpecs.modelVariant.includes('10.9"')) {
    base = 1999900;
  }
  if (tabletSpecs.includesKeyboard) {
    base += 250000;
  }
  return base;
}

/**
 * Audita la autenticidad de la rebaja comparando el precio actual Todo Medio de Pago
 * contra nuestra línea base histórica real y el precio "Antes" que afirma la tienda.
 */
export function auditDiscountAuthenticity(params: {
  category: "tablet" | "laptop";
  priceAllMethods: number;
  storeCrossedPrice?: number;
  historicalBaselinePrice: number;
}): {
  storeClaimedDiscountPct: number;
  realDiscountPct: number;
  realSavingsCop: number;
  authenticity: DiscountAuthenticity;
  authenticityLabel: string;
  authenticityReason: string;
} {
  const {
    category,
    priceAllMethods,
    storeCrossedPrice,
    historicalBaselinePrice,
  } = params;

  const storeClaimedDiscountPct =
    storeCrossedPrice && storeCrossedPrice > priceAllMethods
      ? Math.round(
          ((storeCrossedPrice - priceAllMethods) / storeCrossedPrice) * 100
        )
      : 0;

  const realSavingsCop = historicalBaselinePrice - priceAllMethods;
  const realDiscountPct = Math.round(
    (realSavingsCop / historicalBaselinePrice) * 100
  );

  // Detectar si un portátil de gama alta (Valor base >= 3.25M) cayó al rango objetivo (<= 2.95M)
  if (
    category === "laptop" &&
    historicalBaselinePrice >= 3250000 &&
    priceAllMethods <= 2950000
  ) {
    return {
      storeClaimedDiscountPct,
      realDiscountPct,
      realSavingsCop,
      authenticity: "caza_mayor",
      authenticityLabel: "🚨 Caza Mayor: Gama Alta en Rango",
      authenticityReason: `Este equipo cuesta normalmente ~$${formatMillions(
        historicalBaselinePrice
      )} por sus componentes y bajó a $${formatMillions(
        priceAllMethods
      )} (Ahorro real verificado: $${realSavingsCop.toLocaleString("es-CO")}).`,
    };
  }

  // Oferta real verificada: al menos 7% por debajo del precio real histórico de mercado
  if (realDiscountPct >= 7) {
    const inflatedNote =
      storeClaimedDiscountPct - realDiscountPct >= 15
        ? ` (La tienda dice -${storeClaimedDiscountPct}% inflando el precio tachado, pero el descuento real sigue siendo un buen -${realDiscountPct}%).`
        : ".";
    return {
      storeClaimedDiscountPct,
      realDiscountPct,
      realSavingsCop,
      authenticity: "verified_real_deal",
      authenticityLabel: "✅ Rebaja Real Verificada",
      authenticityReason: `Está $${realSavingsCop.toLocaleString(
        "es-CO"
      )} (-${realDiscountPct}% real) por debajo de su precio normal de mercado ($${historicalBaselinePrice.toLocaleString(
        "es-CO"
      )})${inflatedNote}`,
    };
  }

  // Descuento inflado / falso: la tienda dice >= 20% OFF pero el precio final es igual o mayor al valor normal de mercado
  if (storeClaimedDiscountPct >= 18 && realDiscountPct <= 3) {
    return {
      storeClaimedDiscountPct,
      realDiscountPct,
      realSavingsCop,
      authenticity: "inflated_fake_discount",
      authenticityLabel: "⚠️ Descuento Tachado Inflado",
      authenticityReason: `La tienda muestra un "Antes" inflado de $${(
        storeCrossedPrice || 0
      ).toLocaleString(
        "es-CO"
      )} (-${storeClaimedDiscountPct}%), pero su precio normal real en Colombia es ~$${historicalBaselinePrice.toLocaleString(
        "es-CO"
      )}.`,
    };
  }

  if (realDiscountPct < -6) {
    return {
      storeClaimedDiscountPct,
      realDiscountPct,
      realSavingsCop,
      authenticity: "above_market",
      authenticityLabel: "💸 Más Caro que el Promedio",
      authenticityReason: `Hoy está $${Math.abs(realSavingsCop).toLocaleString(
        "es-CO"
      )} por encima del valor habitual de un equipo con estas características.`,
    };
  }

  return {
    storeClaimedDiscountPct,
    realDiscountPct,
    realSavingsCop,
    authenticity: "fair_price",
    authenticityLabel: "⚖️ Precio Justo de Mercado",
    authenticityReason: `Está en su precio competitivo habitual (~$${historicalBaselinePrice.toLocaleString(
      "es-CO"
    )}). Esperando rebaja de Black Friday.`,
  };
}

function formatMillions(val: number): string {
  return (val / 1000000).toFixed(2) + "M";
}

