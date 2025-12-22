// Root layout - middleware will redirect to /en
// Actual layout with HTML structure is in [locale]/layout.tsx
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
