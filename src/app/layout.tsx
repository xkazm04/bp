import type { Metadata } from 'next';
import { Caveat, IBM_Plex_Mono, IBM_Plex_Sans_Condensed } from 'next/font/google';
import './globals.css';

const sans = IBM_Plex_Sans_Condensed({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-sans' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono' });
// the hand face only draws red-pencil notes on the feature page, never on first paint: fetched when used, not preloaded
const hand = Caveat({ subsets: ['latin'], weight: ['500'], variable: '--font-hand', preload: false });

export const metadata: Metadata = {
  title: 'Kettle blueprint',
  description: 'A product drawn as a blueprint, with a simulated agent swarm building it. Sample data.',
};

// Sets the theme before first paint so a light-theme viewer never sees a dark flash.
const themeScript = `try{var t=new URLSearchParams(location.search).get('theme')||localStorage.getItem('bp-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable} ${hand.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
