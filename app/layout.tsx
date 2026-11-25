import type { Metadata } from "next";
import { Roboto, Rubik } from "next/font/google";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${roboto.variable} ${rubik.variable}`}>
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
