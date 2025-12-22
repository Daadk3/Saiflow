// Middleware disabled - using client-side language switching instead
// This file is kept for reference but not used

export { default } from 'next-auth/middleware';

export const config = {
  matcher: ['/dashboard/:path*']
};
