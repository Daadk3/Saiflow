"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { UploadButton } from "@/lib/uploadthing";

interface Shop {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo: string | null;
  coverImage: string | null;
}

export default function EditShopPage() {
  const [shop, setShop] = useState<Shop | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [logo, setLogo] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;
  const { status } = useSession();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }

    if (status === "authenticated" && slug) {
      fetchShop();
    }
  }, [status, slug, router]);

  async function fetchShop() {
    try {
      const res = await fetch(`/api/shops/${slug}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Shop not found");
        setLoading(false);
        return;
      }

      setShop(data);
      setName(data.name);
      setDescription(data.description || "");
      setLogo(data.logo || "");
      setCoverImage(data.coverImage || "");
    } catch (err) {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!shop) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/shops/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          logo: logo || null,
          coverImage: coverImage || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      setSuccess("Shop updated successfully!");
      
      // If slug changed, redirect to new URL
      if (data.slug !== slug) {
        setTimeout(() => {
          router.push(`/dashboard/shop/${data.slug}`);
        }, 1500);
      } else {
        setTimeout(() => {
          router.push(`/dashboard/shop/${slug}`);
        }, 1500);
      }
    } catch (err) {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-500"></div>
          <p className="text-gray-400">Loading shop...</p>
        </div>
      </div>
    );
  }

  if (error && !shop) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] p-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6">
            <h1 className="text-2xl font-bold text-red-400 mb-2">Error</h1>
            <p className="text-red-300 mb-4">{error}</p>
            <Link 
              href="/dashboard"
              className="inline-flex items-center gap-2 text-teal-400 hover:text-teal-300 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-teal-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-cyan-500/10 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-gray-800/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <Image
                src="/mascot.png"
                alt="Saiflow"
                width={48}
                height={48}
                className="h-12 w-auto object-contain"
                priority
              />
              <span className="text-xl font-bold text-white">Saiflow</span>
            </Link>

            <Link
              href={`/dashboard/shop/${slug}`}
              className="flex items-center gap-2 text-gray-400 hover:text-teal-400 transition-colors group"
            >
              <svg 
                className="w-5 h-5 transition-transform group-hover:-translate-x-1" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span>Back to {shop?.name || "Shop"}</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl">
          {/* Card */}
          <div className="bg-[#111111] rounded-2xl border border-gray-800/50 shadow-2xl shadow-black/50 p-8">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-teal-500/10 mb-4">
                <svg className="w-7 h-7 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-white">Edit Shop</h1>
              <p className="mt-2 text-gray-500">Update your shop details and branding</p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Cover Image Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Cover Image / Banner
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  A banner image for your shop (recommended: 1200x400px)
                </p>
                
                {coverImage ? (
                  <div className="relative">
                    <Image
                      src={coverImage}
                      alt="Shop cover"
                      width={600}
                      height={200}
                      className="w-full h-40 object-cover rounded-xl border border-gray-800"
                    />
                    <button
                      type="button"
                      onClick={() => setCoverImage("")}
                      className="absolute top-2 right-2 w-8 h-8 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center transition-colors"
                    >
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-gray-800 rounded-xl p-6 text-center hover:border-teal-500/50 transition-colors">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gray-800/50 mb-3">
                      <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-gray-400 text-sm mb-2">Upload a cover image</p>
                    <UploadButton
                      endpoint="shopCover"
                      onClientUploadComplete={(res) => {
                        if (res?.[0]) {
                          setCoverImage(res[0].ufsUrl || res[0].url);
                        }
                      }}
                      onUploadError={(error: Error) => {
                        setError(`Cover upload failed: ${error.message}`);
                      }}
                      appearance={{
                        button: "bg-gray-700 hover:bg-gray-600 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm ut-uploading:bg-gray-700/50",
                        allowedContent: "text-gray-500 text-xs mt-2",
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Logo Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Shop Logo
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  A square logo for your shop (recommended: 200x200px)
                </p>
                
                <div className="flex items-start gap-4">
                  {logo ? (
                    <div className="relative">
                      <Image
                        src={logo}
                        alt="Shop logo"
                        width={100}
                        height={100}
                        className="w-24 h-24 object-cover rounded-xl border border-gray-800"
                      />
                      <button
                        type="button"
                        onClick={() => setLogo("")}
                        className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center transition-colors"
                      >
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-gray-800 rounded-xl p-4 text-center hover:border-teal-500/50 transition-colors flex-1">
                      <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gray-800/50 mb-2">
                        <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                      <p className="text-gray-400 text-sm mb-2">Upload logo</p>
                      <UploadButton
                        endpoint="shopLogo"
                        onClientUploadComplete={(res) => {
                          if (res?.[0]) {
                            setLogo(res[0].ufsUrl || res[0].url);
                          }
                        }}
                        onUploadError={(error: Error) => {
                          setError(`Logo upload failed: ${error.message}`);
                        }}
                        appearance={{
                          button: "bg-gray-700 hover:bg-gray-600 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm ut-uploading:bg-gray-700/50",
                          allowedContent: "text-gray-500 text-xs mt-2",
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Shop Name */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-2">
                  Shop Name <span className="text-teal-400">*</span>
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g., My Awesome Shop"
                  className="w-full px-4 py-3 bg-[#0a0a0a] border border-gray-800 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors"
                />
              </div>

              {/* Description */}
              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-300 mb-2">
                  Description
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Describe your shop and what you sell..."
                  className="w-full px-4 py-3 bg-[#0a0a0a] border border-gray-800 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors resize-none"
                />
              </div>

              {/* Error Message */}
              {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              {/* Success Message */}
              {success && (
                <div className="p-4 bg-teal-500/10 border border-teal-500/20 rounded-xl">
                  <p className="text-teal-400 text-sm">{success}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-4">
                <Link
                  href={`/dashboard/shop/${slug}`}
                  className="flex-1 py-3 px-4 bg-[#0a0a0a] hover:bg-gray-900 text-gray-300 font-semibold rounded-xl border border-gray-800 transition-colors duration-200 text-center"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-3 px-4 bg-teal-500 hover:bg-teal-400 disabled:bg-teal-500/50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors duration-200 flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Saving...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Help Text */}
          <p className="mt-6 text-center text-gray-600 text-sm">
            Changes will be reflected immediately on your public shop page
          </p>
        </div>
      </main>
    </div>
  );
}

