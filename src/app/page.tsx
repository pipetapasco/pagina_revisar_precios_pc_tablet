import React from "react";
import PriceRadarDashboard from "@/components/PriceRadarDashboard";
import { detectTriggerableAlerts } from "@/lib/alerts";
import { getInstantSeedOffers } from "@/lib/scrapers";
import { getStorageBackendMode, loadPersistedState } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const persisted = await loadPersistedState();
  const hasSavedOffers = persisted.lastOffers.length > 0;

  const initialOffers = hasSavedOffers
    ? persisted.lastOffers
    : getInstantSeedOffers();
  const initialAlerts = detectTriggerableAlerts(initialOffers);
  const initialCheckedAt =
    persisted.lastUpdatedAt || new Date().toISOString();
  const initialStorageMode = getStorageBackendMode();
  const whatsAppConfigured = Boolean(
    process.env.WA_TOKEN && process.env.WA_PHONE_ID && process.env.MI_NUMERO
  );

  return (
    <PriceRadarDashboard
      initialOffers={initialOffers}
      initialAlerts={initialAlerts}
      initialCheckedAt={initialCheckedAt}
      initialStorageMode={initialStorageMode}
      whatsAppConfigured={whatsAppConfigured}
    />
  );
}
