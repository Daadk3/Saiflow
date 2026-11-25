import { Cairo } from "next/font/google";

/** The Cairo face the /agents pages are drawn in. */
export const agentsFont = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
  variable: "--font-agents",
});
