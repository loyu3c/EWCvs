import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const previewImage = `${protocol}://${host}/og.png`;
  return {
    title: { default: "福委改選投票系統", template: "%s｜福委改選投票系統" },
    description: "公司福委改選的線上投票與即時開票管理系統。",
    openGraph: {
      title: "2026 年福委改選",
      description: "一張選票，一份對工作生活的期待。",
      type: "website",
      locale: "zh_TW",
      images: [{ url: previewImage, width: 1200, height: 630, alt: "2026 年福委改選" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "2026 年福委改選",
      description: "一張選票，一份對工作生活的期待。",
      images: [previewImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
