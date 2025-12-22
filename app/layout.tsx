import "./globals.css";

// Root layout - middleware handles locale routing
// Actual layout with HTML structure is in [locale]/layout.tsx
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
