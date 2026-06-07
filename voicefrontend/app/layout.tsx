// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { ThemeToastContainer } from "@/components/Themetoast";

export const metadata: Metadata = {
  title: "Jocasta — Neural Voice Intelligence",
  description: "Advanced neural voice assistant. Speak naturally, think together, act with precision.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased dark" suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {/* Theme init script — runs before paint to avoid flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                try {
                  var saved = localStorage.getItem('jocasta-theme');
                  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  var dark = saved ? saved === 'dark' : prefersDark;
                  var html = document.documentElement;
                  if (dark) {
                    html.removeAttribute('data-theme');
                    html.classList.add('dark');
                    html.classList.remove('light');
                  } else {
                    html.setAttribute('data-theme','light');
                    html.classList.add('light');
                    html.classList.remove('dark');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
        <Navbar />
        {children}

        <ThemeToastContainer />
      </body>
    </html>
  );
}