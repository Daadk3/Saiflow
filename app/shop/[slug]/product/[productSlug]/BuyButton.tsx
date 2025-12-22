"use client";

import { useState } from "react";

interface BuyButtonProps {
  productId: string;
  hasFile?: boolean;
}

export default function BuyButton({ productId, hasFile = true }: BuyButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileInvalid, setFileInvalid] = useState(false);

  // Hard block: Don't allow checkout if no file or file is invalid
  const isDisabled = loading || !hasFile || fileInvalid;

  async function handleCheckout() {
    // Double-check on client side
    if (!hasFile) {
      setError("This product is not available for purchase yet");
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMessage = data.error || "Something went wrong";
        setError(errorMessage);
        
        // If error indicates file is not accessible, disable the button permanently
        if (errorMessage.includes("file") || errorMessage.includes("not available") || errorMessage.includes("not accessible")) {
          setFileInvalid(true);
        }
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      } else {
        setError("Something went wrong");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // If no file, show disabled state
  if (!hasFile) {
    return (
      <div className="space-y-3">
        <button
          disabled
          className="w-full sm:w-auto bg-gray-600 cursor-not-allowed text-gray-400 px-8 py-4 rounded-xl text-lg font-semibold flex items-center justify-center gap-3 opacity-60"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          Not Available
        </button>
        <p className="text-amber-400 text-sm text-center">
          This product is not available for purchase yet
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        onClick={handleCheckout}
        disabled={isDisabled}
        className={`w-full sm:w-auto px-8 py-4 rounded-xl text-lg font-semibold transition-all duration-200 flex items-center justify-center gap-3 ${
          fileInvalid
            ? "bg-gray-600 cursor-not-allowed text-gray-400 opacity-60"
            : "bg-teal-500 hover:bg-teal-400 disabled:bg-teal-500/50 disabled:cursor-not-allowed text-white hover:shadow-lg hover:shadow-teal-500/25"
        }`}
      >
        {loading ? (
          <>
            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Processing...
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Buy Now
          </>
        )}
      </button>
      
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-sm text-center">{error}</p>
        </div>
      )}
    </div>
  );
}
