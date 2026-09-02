import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: 'Greenhouse Lockdown',
  description: 'A hands-on AI agent security workshop for Hackeriot.',
  openGraph: {
    title: 'Greenhouse Lockdown',
    description: 'Hackeriot AI Security Workshop',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Greenhouse Lockdown — Hackeriot AI Security Workshop' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Greenhouse Lockdown',
    description: 'Hackeriot AI Security Workshop',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
