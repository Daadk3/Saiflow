"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { UploadButton } from "@/lib/uploadthing";

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  fileUrl: string | null;
  thumbnailUrl: string | null;
  shop: {
    id: string;
    name: string;
    slug: string;
  };
}

export default function EditProductPage() {
  const [product, setProduct] = useState<Product | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;
  const productSlug = params.productSlug as string;
  const { status } = useSession();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }

    if (status === "authenticated" && slug && productSlug) {
      fetchProduct();
    }
  }, [status, slug, productSlug, router]);

  async function fetchProduct() {
    try {
      // First get the shop to find the product
      const shopRes = await fetch(`/api/shops/${slug}`);
      const shopData = await shopRes.json();
      
      if (!shopRes.ok) {
        setError("Shop not found");
        setLoading(false);
        return;
      }

      // Find the product in the shop's products
      const foundProduct = shopData.products?.find(
        (p: Product) => p.slug === productSlug
      );

      if (!foundProduct) {
        setError("Product not found");
        setLoading(false);
        return;
      }

      // Fetch full product details
      const productRes = await fetch(`/api/products/${foundProduct.id}`);
      const productData = await productRes.json();

      if (!productRes.ok) {
        setError(productData.error || "Failed to load product");
        setLoading(false);
        return;
      }

      setProduct(productData);
      setName(productData.name);
      setDescription(productData.description || "");
      setPrice(String(productData.price));
      setFileUrl(productData.fileUrl || "");
      setThumbnailUrl(productData.thumbnailUrl || "");
      if (productData.fileUrl) {
        setFileName("Current file");
      }
    } catch (err) {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          price: parseFloat(price),
          fileUrl: fileUrl || null,
          thumbnailUrl: thumbnailUrl || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      setSuccess("Product updated successfully!");
      
      // Redirect after a short delay
      setTimeout(() => {
        router.push(`/dashboard/shop/${slug}`);
      }, 1500);
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
          <p className="text-gray-400">Loading product...</p>
        </div>
      </div>
    );
  }

  if (error && !product) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] p-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6">
            <h1 className="text-2xl font-bold text-red-400 mb-2">Error</h1>
            <p className="text-red-300 mb-4">{error}</p>
            <Link 
              href={`/dashboard/shop/${slug}`}
              className="inline-flex items-center gap-2 text-teal-400 hover:text-teal-300 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Shop
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
              <span>Back to {product?.shop?.name || "Shop"}</span>
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
              <h1 className="text-2xl font-bold text-white">Edit Product</h1>
              <p className="mt-2 text-gray-500">Update your product details</p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Thumbnail Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Product Thumbnail
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  Update the preview image (PNG, JPG, max 4MB)
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

              {/* File Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Product File
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  Upload a new file to replace the existing one, or leave as is
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
                  <div className="space-y-3">
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
                        title="Remove file"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                    {/* Test download link */}
                    <div className="flex items-center gap-2">
                      <a
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-gray-500 hover:text-teal-400 underline"
                      >
                        Test download link
                      </a>
                      <span className="text-xs text-gray-600">•</span>
                      <span className="text-xs text-gray-600">
                        If the download doesn&apos;t work, remove and re-upload the file
                      </span>
                    </div>
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
            Changes will be reflected immediately on your shop page
          </p>
        </div>
      </main>
    </div>
  );
}
