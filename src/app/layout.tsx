import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#059669",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "SwasthTrack — Health Intelligence & Family Care",
  description: "A personal health tracking and family care companion for parents and caregivers.",
  applicationName: "SwasthTrack",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SwasthTrack",
  },
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "64x64", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="hi" className="h-full antialiased font-sans">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="SwasthTrack" />
      </head>
      <body className="min-h-full bg-slate-50 text-slate-900 selection:bg-emerald-500 selection:text-white">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
