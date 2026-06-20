import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="ja">
      <body className="min-h-screen antialiased">
        <div className="mx-auto max-w-screen-lg px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </div>
      </body>
    </html>
  );
}
