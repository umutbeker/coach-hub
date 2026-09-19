import type { Metadata } from "next";
import { Barlow_Semi_Condensed, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { TEAM_NAME } from "../lib/team";

// Barlow Semi Condensed — NOT 'Barlow' or 'Barlow Condensed'. The draft room
// asks for those two by name and has always fallen back to system sans because
// nothing ever loaded them; loading them here would silently restyle a page
// that is deliberately out of scope.
const display = Barlow_Semi_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const body = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const num = IBM_Plex_Mono({
  variable: "--font-num",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: `${TEAM_NAME} Hub`,
  description: `Team hub for ${TEAM_NAME} — solo queue form, match history and draft preparation`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} ${num.variable}`}>
        {children}
      </body>
    </html>
  );
}
