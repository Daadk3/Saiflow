"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { UploadButton } from "@/lib/uploadthing";

export default function AddProductPage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [shopName, setShopName] = useState<string>("");

  const categories = [
    { value: "", label: "Select a category (optional)" },
    { value: "ebooks", label: "eBooks & Guides" },
    { value: "courses", label: "Online Courses" },
    { value: "templates", label: "Templates & Themes" },
    { value: "music", label: "Music & Audio" },
    { value: "art", label: "Art & Graphics" },
    { value: "software", label: "Software & Apps" },
  ];

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
      if (res.ok) {
        setShopId(data.id);
        setShopName(data.name);
      }
    } catch (err) {
      console.error("Error fetching shop:", err);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!shopId) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          price: parseFloat(price),
          category: category || null,
          shopId,
          fileUrl,
          thumbnailUrl,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      router.push(`/dashboard/shop/${slug}`);
    } catch (err) {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
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
              <span>Back to {shopName || "Shop"}</span>
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
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-white">Add New Product</h1>
              <p className="mt-2 text-gray-500">Create a new digital product to sell</p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Thumbnail Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Product Thumbnail
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  Add a preview image to attract buyers (PNG, JPG, max 4MB)
                </p>
                
                {thumbnailUrl ? (
                  <div className="relative inline-block">
                    <Image
                      src={thumbnailUrl}
                      alt="Product thumbnail"
                      width={200}
                      height={200}
                      className="rounded-xl border border-gray-800 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setThumbnailUrl("")}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center transition-colors"
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
                    <p className="text-gray-400 text-sm mb-2">Upload a thumbnail image</p>
                    <UploadButton
                      endpoint="productThumbnail"
                      onClientUploadComplete={(res) => {
                        if (res?.[0]) {
                          // Use ufsUrl for v7+ or fall back to url
                          setThumbnailUrl(res[0].ufsUrl || res[0].url);
                        }
                      }}
                      onUploadError={(error: Error) => {
                        setError(`Thumbnail upload failed: ${error.message}`);
                      }}
                      appearance={{
                        button: "bg-gray-700 hover:bg-gray-600 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm ut-uploading:bg-gray-700/50",
                        allowedContent: "text-gray-500 text-xs mt-2",
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Product Name */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-2">
                  Product Name <span className="text-teal-400">*</span>
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g., My Awesome Ebook"
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
                  placeholder="Describe your product and what buyers will get..."
                  className="w-full px-4 py-3 bg-[#0a0a0a] border border-gray-800 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors resize-none"
                />
              </div>

              {/* Price */}
              <div>
                <label htmlFor="price" className="block text-sm font-medium text-gray-300 mb-2">
                  Price (USD) <span className="text-teal-400">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <input
                    id="price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    required
                    placeholder="9.99"
                    className="w-full pl-8 pr-4 py-3 bg-[#0a0a0a] border border-gray-800 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors"
                  />
                </div>
              </div>

              {/* Category */}
              <div>
                <label htmlFor="category" className="block text-sm font-medium text-gray-300 mb-2">
                  Category
                </label>
                <select
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-4 py-3 bg-[#0a0a0a] border border-gray-800 rounded-xl text-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors"
                >
                  {categories.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Help buyers find your product by selecting a category
                </p>
              </div>

              {/* File Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Product File <span className="text-teal-400">*</span>
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  Upload your digital product file
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  <span className="px-2 py-1 text-xs bg-gray-800 text-gray-400 rounded">PDF</span>
                  <span className="px-2 py-1 text-xs bg-gray-800 text-gray-400 rounded">ZIP</span>
                  <span className="px-2 py-1 text-xs bg-gray-800 text-gray-400 rounded">EPUB</span>
                  <span className="px-2 py-1 text-xs bg-purple-500/20 text-purple-400 rounded">MP3</span>
                  <span className="px-2 py-1 text-xs bg-purple-500/20 text-purple-400 rounded">WAV</span>
                  <span className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded">MP4</span>
                  <span className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded">MOV</span>
                  <span className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 rounded">PNG</span>
                  <span className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 rounded">JPG</span>
                </div>
                
                {fileUrl ? (
                  <div className="flex items-center gap-3 p-4 bg-teal-500/10 border border-teal-500/20 rounded-xl">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-teal-500/20 flex items-center justify-center">
                      <svg className="w-5 h-5 text-teal-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-teal-400 font-medium truncate">{fileName || "File uploaded!"}</p>
                      <p className="text-xs text-gray-500">Ready to go</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setFileUrl(""); setFileName(""); }}
                      className="flex-shrink-0 text-gray-400 hover:text-red-400 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="border-2 border-dashed border-gray-800 rounded-xl p-8 text-center hover:border-teal-500/50 transition-colors">
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gray-800/50 mb-4">
                        <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                      </div>
                      <p className="text-gray-400 mb-2">Drag and drop your file here, or</p>
                      <UploadButton
                        endpoint="productFile"
                        onClientUploadComplete={(res) => {
                          if (res?.[0]) {
                            setFileUrl(res[0].ufsUrl || res[0].url);
                            setFileName(res[0].name);
                          }
                        }}
                        onUploadError={(error: Error) => {
                          setError(`Upload failed: ${error.message}`);
                        }}
                        appearance={{
                          button: "bg-teal-500 hover:bg-teal-400 text-white font-medium px-6 py-2 rounded-lg transition-colors ut-uploading:bg-teal-500/50",
                          allowedContent: "text-gray-500 text-xs mt-2",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Error Message */}
              {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading || !shopId}
                className="w-full py-3 px-4 bg-teal-500 hover:bg-teal-400 disabled:bg-teal-500/50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors duration-200 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Creating Product...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create Product
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Help Text */}
          <p className="mt-6 text-center text-gray-600 text-sm">
            Need help? Check out our{" "}
            <a href="#" className="text-teal-400 hover:text-teal-300 transition-colors">
              product creation guide
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
