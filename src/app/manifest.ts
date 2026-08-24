import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SwasthTrack — Health Intelligence & Family Care",
    short_name: "SwasthTrack",
    description: "A personalized health tracking and family care companion for parents and caregivers.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#059669",
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
