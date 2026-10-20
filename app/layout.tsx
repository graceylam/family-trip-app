import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") || "https";
  const imageUrl = host ? `${protocol}://${host}/og-fun.jpg` : undefined;
  const title = "Our Family Adventure";
  const description = "Plan the adventure together and keep every family memory in one place.";
  return {
    title,
    description,
    manifest: "./manifest.webmanifest",
    icons: { icon: "./favicon.svg", apple: "./favicon.svg" },
    openGraph: {
      title,
      description,
      type: "website",
      images: imageUrl ? [{ url: imageUrl, width: 1536, height: 803, alt: "Our Family Adventure Vienna travel journal" }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: imageUrl ? [imageUrl] : undefined,
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#3d789b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
