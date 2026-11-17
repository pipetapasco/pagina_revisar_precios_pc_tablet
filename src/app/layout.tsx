import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Radar Black Friday Colombia | Galaxy Tab S10 FE+ & Portátil Ideal",
  description:
    "Monitor de precios reales anti-descuentos inflados en tiendas confiables de Colombia para la Samsung Galaxy Tab S10 FE+ (12GB/256GB) y el mejor portátil entre $2.5M y $2.9M COP.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="antialiased selection:bg-emerald-500 selection:text-slate-950">
        {children}
      </body>
    </html>
  );
}

