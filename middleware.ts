// Active middleware: NextAuth session guard for all /dashboard routes.
// (Locale switching is cookie-based via i18n.ts and does not use middleware.)

export { default } from 'next-auth/middleware';

export const config = {
  matcher: ['/dashboard/:path*']
};
