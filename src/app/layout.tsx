import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { LayoutShell } from '@/components/layout/LayoutShell';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AdPilot — Facebook Ads Optimizer',
  description:
    'AI-powered Facebook Ads optimization tool for Frenzidea. Scale winners, kill losers, and optimize budget allocation with LTV-adjusted CPA tracking.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}
