import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brisa — tus tareas, en calma",
  description: "Gestor personal de tareas local con captura inteligente por voz.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/brisa-48.png", apple: "/brisa-192.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Brisa" },
};

export const viewport: Viewport = {
  themeColor: "#302e29",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
