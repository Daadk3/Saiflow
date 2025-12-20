export default function TrustBadges() {
  return (
    <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div className="flex flex-col items-center text-center">
          <svg
            className="w-8 h-8 text-[#00FFB3] mb-2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <p className="text-sm font-semibold text-white">SSL Encrypted</p>
          <p className="text-xs text-gray-400 mt-1">Bank-level security</p>
        </div>
        
        <div className="flex flex-col items-center text-center">
          <svg
            className="w-8 h-8 text-[#00FFB3] mb-2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
          <p className="text-sm font-semibold text-white">Secure Payments</p>
          <p className="text-xs text-gray-400 mt-1">PCI DSS compliant</p>
        </div>
        
        <div className="flex flex-col items-center text-center">
          <svg
            className="w-8 h-8 text-[#00FFB3] mb-2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-sm font-semibold text-white">GDPR Compliant</p>
          <p className="text-xs text-gray-400 mt-1">Data protection</p>
        </div>
        
        <div className="flex flex-col items-center text-center">
          <svg
            className="w-8 h-8 text-[#00FFB3] mb-2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
            />
          </svg>
          <p className="text-sm font-semibold text-white">Trusted Payments</p>
          <p className="text-xs text-gray-400 mt-1">Stripe & PayPal</p>
        </div>
      </div>
    </div>
  );
}

