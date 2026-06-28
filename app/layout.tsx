import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NexusAI — Institutional Investment Research Agent",
  description:
    "AI-powered investment research platform. Enter any public company and receive an institutional-grade Invest / Pass decision powered by multi-agent LangGraph analysis.",
  keywords: ["investment research", "AI", "stock analysis", "financial research", "LangGraph", "LLM"],
  openGraph: {
    title: "NexusAI — Institutional Investment Research Agent",
    description: "Institutional-grade AI investment research powered by multi-agent LangGraph analysis.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
