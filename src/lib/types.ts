export type StoreId =
  | "alkosto"
  | "ktronix"
  | "falabella"
  | "exito"
  | "panamericana"
  | "olimpica"
  | "samsung"
  | "lenovo"
  | "asus"
  | "hp"
  | "mercadolibre"
  | "amazon"
  | "tauret"
  | "speedlogic"
  | "clonesyperifericos";

export type ProductCategory = "tablet" | "laptop";

export type DiscountAuthenticity =
  | "caza_mayor" // Un equipo de gama superior (3.3M - 4.2M) cayó a <= 2.95M
  | "verified_real_deal" // Descuento real >= 8% frente al histórico y mercado
  | "fair_price" // Precio normal competitivo de mercado (sin inflación engañosa)
  | "inflated_fake_discount" // La tienda infló el precio "Antes" para fingir una rebaja grande
  | "above_market"; // Más caro que el promedio de otras tiendas confiables

export interface TabletSpecs {
  isExactTarget: boolean;
  modelVariant:
    | "S10 FE+ 12GB / 256GB (Objetivo Exacto)"
    | "S10+ 12GB / 256GB (Gama Alta Dynamic AMOLED)"
    | "S10 FE+ 8GB / 128GB (Variante de 128GB)"
    | "S10 FE 10.9\" 8GB / 128GB (Modelo No-Plus)";
  ramGb: number;
  storageGb: number;
  screenInches: string;
  includesKeyboard: boolean;
  includesSPen: boolean;
}

export interface LaptopScoreBreakdown {
  cpuPoints: number; // Max 45
  ramSsdPoints: number; // Max 25
  gpuPortabilityPoints: number; // Max 20
  dealPoints: number; // Max 10
  reasons: string[];
}

export interface LaptopSpecs {
  cpuModel: string;
  cpuTier: "top" | "high" | "mid" | "rejected";
  ramGb: number;
  ssdGb: number;
  gpuModel: string;
  hasDedicatedGpu: boolean;
  screenInches: string;
  hardwareScore: number; // 0 - 100
  minecraftPerformance:
    | "Ultra Fluido (+140 FPS y Shaders)"
    | "Muy Fluido (+100 FPS estable)"
    | "Fluido (+65 FPS para jugar tranquilo)";
  teachingDurability: string;
  scoreBreakdown: LaptopScoreBreakdown;
}

export interface PriceHistoryPoint {
  timestamp: string;
  price: number;
}

export interface TrackedOffer {
  id: string;
  eanOrSku: string;
  category: ProductCategory;
  title: string;
  brand: string;
  storeId: StoreId;
  storeName: string;
  sellerName: string;
  isOfficialSeller: boolean;
  url: string;
  imageUrl: string;
  /** Precio principal TODO MEDIO DE PAGO (PSE, débito, cualquier tarjeta) */
  priceAllMethods: number;
  /** Precio opcional si se paga con tarjeta específica de la tienda (CMR, Tuya, Davivienda, etc.) */
  priceCardSpecial?: number;
  cardName?: string;
  /** Precio "Antes" tachado que muestra la tienda */
  storeCrossedPrice?: number;
  /** % de descuento que dice tener la tienda según su precio tachado */
  storeClaimedDiscountPct: number;
  /** Precio base real verificable (mediana histórica pre-Black Friday + cruce entre tiendas) */
  historicalBaselinePrice: number;
  /** % de descuento REAL frente al valor real histórico/mercado */
  realDiscountPct: number;
  /** Ahorro real en pesos colombianos frente al precio base real */
  realSavingsCop: number;
  authenticity: DiscountAuthenticity;
  authenticityLabel: string;
  authenticityReason: string;
  tabletSpecs?: TabletSpecs;
  laptopSpecs?: LaptopSpecs;
  priceHistory: PriceHistoryPoint[];
  lastCheckedAt: string;
  inStock: boolean;
  isLiveScraped: boolean;
}

export interface StoreGroupStatus {
  groupId: string;
  groupName: string;
  stores: string[];
  status: "idle" | "loading" | "success" | "error";
  offersFound: number;
  durationMs?: number;
  lastError?: string;
}

export interface AlertNotificationItem {
  id: string;
  createdAt: string;
  type: "tablet_drop" | "laptop_caza_mayor" | "laptop_real_deal";
  title: string;
  message: string;
  offerId: string;
  storeName: string;
  priceAllMethods: number;
  realDiscountPct: number;
  url: string;
}

