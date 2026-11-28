import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Roboto, Rubik } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { PostHogAuth } from "@/components/theme-switcher";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "dmplease - Instagram Comment-to-DM Automation",
  description: "Automate Instagram comments into high-converting direct messages instantly with Meta Graph API.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1c1e" },
  ],
};

const roboto = Roboto({
  weight: ["300", "400", "500", "700", "900"],
  subsets: ["latin"],
  variable: "--font-roboto",
  display: "swap",
});

const rubik = Rubik({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  variable: "--font-rubik",
  display: "swap",
});

const plusJakarta = Plus_Jakarta_Sans({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${roboto.variable} ${rubik.variable} ${plusJakarta.variable}`}>
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <PostHogAuth />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
