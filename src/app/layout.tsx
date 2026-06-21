import type { Metadata } from "next";
import { Fredoka, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

// 見出し/ブランド = Fredoka、本文 = Noto Sans JP（ワイヤーフレーム指定 / docs/wireframes）。
const fredoka = Fredoka({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-fredoka",
  display: "swap",
});
const notoSansJp = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-jp",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lapsy",
  description: "IT資格学習支援アプリ — ポモドーロのラップ単位で学習を積み重ねる",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${fredoka.variable} ${notoSansJp.variable}`}>
      <body className="min-h-screen font-[family-name:var(--font-noto-sans-jp)] antialiased">
        <div className="mx-auto max-w-screen-lg px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </div>
      </body>
    </html>
  );
}
