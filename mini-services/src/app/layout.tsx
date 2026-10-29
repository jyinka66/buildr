import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Buildr — Build, Launch & Scale with AI",
  description: "Build production-ready apps, launch complete businesses, and scale with autonomous AI operations. One platform, infinite possibilities.",
  keywords: ["AI app builder", "code generation", "business launch", "Next.js", "code generation", "deploy"],
  authors: [{ name: "Buildr" }],
  icons: {
    icon: "/favicon.svg",
    apple: "/logo.svg",
  },
  openGraph: {
    title: "Buildr — Build, Launch & Scale with AI",
    description: "Build apps, launch businesses, and run autonomous operations — all powered by AI.",
    url: "https://chat.z.ai",
    siteName: "Buildr",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Buildr — Build, Launch & Scale with AI",
    description: "Build apps, launch businesses, and run autonomous operations — all powered by AI.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <SonnerToaster richColors closeButton position="bottom-right" />
      </body>
    </html>
  );
}
