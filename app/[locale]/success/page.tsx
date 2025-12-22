"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

interface DownloadInfo {
  productName: string;
  downloadUrl: string;
}

function SuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  
  const [downloadInfo, setDownloadInfo] = useState<DownloadInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDownloadUrl() {
      if (!sessionId) {
        setLoading(false);
        setError("No session found");
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(`/api/download/${sessionId}?format=json`);
        const data = await response.json();

        if (!response.ok) {
          setError(data.error || "Failed to get download link");
          setLoading(false);
          return;
        }

        // Validate that we got the expected data structure
        if (data.productName && data.downloadUrl) {
          setDownloadInfo(data);
        } else {
          setError("Invalid response from server");
        }
      } catch (err) {
        console.error("Error fetching download info:", err);
        setError("Failed to fetch download information");
      } finally {
        setLoading(false);
      }
    }

    fetchDownloadUrl();
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-teal-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-cyan-500/10 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 p-6">
        <Link href="/" className="inline-flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
            </svg>
          </div>
          <span className="text-xl font-bold text-white">Saiflow</span>
        </Link>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="bg-[#111111] rounded-2xl border border-gray-800/50 shadow-2xl shadow-black/50 p-8 text-center">
            <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6 ring-4 ring-emerald-500/10">
              <svg
                className="w-8 h-8 text-emerald-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            
            <h1 className="text-2xl font-bold text-white mb-2">
              Payment Successful!
            </h1>
            
            <p className="text-gray-400 mb-8">
              Thank you for your purchase.
            </p>

            {loading && (
              <div className="mb-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500 mx-auto"></div>
                <p className="text-gray-500 mt-3">Preparing your download...</p>
              </div>
            )}

            {!loading && error && !downloadInfo && (
              <div className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                <p className="text-red-400">{error}</p>
              </div>
            )}

            {!loading && downloadInfo && (
              <div className="mb-8">
                <p className="text-gray-300 mb-4">
                  Your file <strong className="text-white">{downloadInfo.productName}</strong> is ready!
                </p>
                <a
                  href={downloadInfo.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-white px-6 py-3 rounded-xl font-semibold transition-colors"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  Download Your File
                </a>
                <p className="text-gray-500 text-sm mt-4">
                  Having trouble? Contact support at{" "}
                  <a href="mailto:support@saiflow.io" className="text-teal-400 hover:text-teal-300">
                    support@saiflow.io
                  </a>
                </p>
              </div>
            )}
            
            <Link
              href="/browse"
              className="inline-block text-teal-400 hover:text-teal-300 font-medium transition-colors"
            >
              Continue Shopping
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="bg-[#111111] rounded-2xl border border-gray-800/50 p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500 mx-auto"></div>
        <p className="text-gray-400 mt-4">Loading...</p>
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SuccessContent />
    </Suspense>
  );
}
