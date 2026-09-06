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
  title: 'Prompt Lab · MLflow Workshop',
  description: 'An AI-only prompt debugging game for learning MLflow.',
  openGraph: {
    title: 'Prompt Lab · MLflow Workshop',
    description: 'Run AI agents, inspect their traces, and fix the prompt.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Prompt Lab · MLflow Workshop' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Prompt Lab · MLflow Workshop',
    description: 'Run AI agents, inspect their traces, and fix the prompt.',
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
