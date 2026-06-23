import type { Metadata } from "next";
import "./globals.css";
import "./dashboard.css";

export const metadata: Metadata = {
  title: "TimeFlow Sync Server",
  description: "Panel administracyjny serwera synchronizacji TimeFlow",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
