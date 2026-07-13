import "./globals.css";

export const metadata = {
  title: "yield-router-agent — live ops dashboard",
  description: "3 cooperative agents paying each other via x402, executing Mento V3 FPMM swaps on Celo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-celo-black text-zinc-100">{children}</body>
    </html>
  );
}