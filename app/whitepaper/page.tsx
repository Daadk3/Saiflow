"use client";

import Link from "next/link";

export default function WhitepaperPage() {
  return (
    <div className="bg-[#0a0a0a] min-h-screen">
      {/* Header */}
      <section className="border-b border-gray-800 bg-[#0a0a0a] py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Saiflow Whitepaper
          </h1>
          <p className="text-xl text-gray-400">
            Our mission, vision, and the future of digital commerce
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <article className="prose prose-invert prose-lg max-w-none
            prose-headings:text-white
            prose-p:text-gray-300
            prose-strong:text-white
            prose-a:text-teal-400
            prose-a:no-underline
            hover:prose-a:text-teal-300
            prose-ul:text-gray-300
            prose-li:text-gray-300
            prose-ol:text-gray-300">
            
            {/* Introduction / Mission */}
            <section className="mb-16">
              <h2 className="text-3xl font-bold text-white mb-6">Introduction & Mission</h2>
              <p className="text-lg text-gray-300 mb-4">
                Saiflow was born from a simple observation: creators deserve better. The digital marketplace landscape has been dominated by platforms that take significant cuts, limit customization, and create barriers between creators and their customers.
              </p>
              <p className="text-lg text-gray-300 mb-4">
                Our mission is to empower creators by providing a platform that puts them first. We believe that when creators keep more of what they earn, have full control over their brand, and can build direct relationships with customers, everyone wins.
              </p>
              <p className="text-lg text-gray-300">
                <strong className="text-white">Mission Statement:</strong> To democratize digital commerce by giving creators the tools, freedom, and fair economics they need to build sustainable businesses around their digital products.
              </p>
            </section>

            {/* The Problem */}
            <section className="mb-16 bg-[#111111] rounded-2xl p-8 border border-gray-800">
              <h2 className="text-3xl font-bold text-white mb-6">The Problem</h2>
              <p className="text-lg text-gray-300 mb-4">
                Digital creators face numerous challenges when trying to monetize their work:
              </p>
              <ul className="list-disc pl-6 space-y-3 text-gray-300">
                <li>
                  <strong className="text-white">High Transaction Fees:</strong> Many platforms charge 30% or more, significantly reducing creator earnings
                </li>
                <li>
                  <strong className="text-white">Limited Customization:</strong> Creators are forced to use generic templates that don&apos;t reflect their brand
                </li>
                <li>
                  <strong className="text-white">Customer Relationship Barriers:</strong> Platforms often prevent direct communication between creators and customers
                </li>
                <li>
                  <strong className="text-white">Complex Onboarding:</strong> Getting started can be overwhelming with lengthy setup processes
                </li>
                <li>
                  <strong className="text-white">Limited Control:</strong> Creators have little say over pricing, policies, and platform changes
                </li>
                <li>
                  <strong className="text-white">Data Ownership:</strong> Customer data and insights are often locked within the platform
                </li>
              </ul>
            </section>

            {/* Our Solution */}
            <section className="mb-16">
              <h2 className="text-3xl font-bold text-white mb-6">Our Solution</h2>
              <p className="text-lg text-gray-300 mb-6">
                Saiflow addresses these challenges through a creator-first approach:
              </p>
              
              <div className="grid md:grid-cols-2 gap-6 mb-8">
                <div className="bg-[#111111] rounded-xl p-6 border border-gray-800">
                  <div className="text-3xl mb-4">💰</div>
                  <h3 className="text-xl font-semibold text-white mb-3">Fair Economics</h3>
                  <p className="text-gray-300">
                    Lower transaction fees mean creators keep more of their earnings. We believe in sustainable pricing that benefits both creators and the platform.
                  </p>
                </div>
                
                <div className="bg-[#111111] rounded-xl p-6 border border-gray-800">
                  <div className="text-3xl mb-4">🎨</div>
                  <h3 className="text-xl font-semibold text-white mb-3">Full Customization</h3>
                  <p className="text-gray-300">
                    Complete control over your storefront&apos;s appearance, allowing you to create a unique brand experience that resonates with your audience.
                  </p>
                </div>
                
                <div className="bg-[#111111] rounded-xl p-6 border border-gray-800">
                  <div className="text-3xl mb-4">🤝</div>
                  <h3 className="text-xl font-semibold text-white mb-3">Direct Relationships</h3>
                  <p className="text-gray-300">
                    Build genuine connections with your customers. Access to customer data and communication tools help you grow your community.
                  </p>
                </div>
                
                <div className="bg-[#111111] rounded-xl p-6 border border-gray-800">
                  <div className="text-3xl mb-4">⚡</div>
                  <h3 className="text-xl font-semibold text-white mb-3">Simple & Fast</h3>
                  <p className="text-gray-300">
                    Get started in minutes, not weeks. Our intuitive interface makes it easy to create products, manage sales, and grow your business.
                  </p>
                </div>
              </div>
            </section>

            {/* How It Works */}
            <section className="mb-16">
              <h2 className="text-3xl font-bold text-white mb-6">How It Works</h2>
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 font-bold">
                    1
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-white mb-2">Create Your Shop</h3>
                    <p className="text-gray-300">
                      Sign up and create your personalized shop in minutes. Choose your shop name, customize the design, and set up your profile.
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 font-bold">
                    2
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-white mb-2">Add Your Products</h3>
                    <p className="text-gray-300">
                      Upload your digital products, set prices, add descriptions and images. Our platform supports all types of digital content.
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 font-bold">
                    3
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-white mb-2">Share & Sell</h3>
                    <p className="text-gray-300">
                      Share your shop link, promote on social media, or list products in our marketplace. Customers can purchase directly from you.
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 font-bold">
                    4
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-white mb-2">Grow Your Business</h3>
                    <p className="text-gray-300">
                      Use analytics to understand your customers, optimize your products, and scale your digital business. Withdraw earnings whenever you&apos;re ready.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Future Roadmap */}
            <section className="mb-16 bg-gradient-to-br from-teal-500/10 to-cyan-500/10 rounded-2xl p-8 border border-teal-500/20">
              <h2 className="text-3xl font-bold text-white mb-6">Future Roadmap</h2>
              <p className="text-lg text-gray-300 mb-6">
                We&apos;re just getting started. Here&apos;s what&apos;s coming next:
              </p>
              
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="text-teal-400 mt-1">✓</div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">Q1 2024</h3>
                    <p className="text-gray-300">Enhanced analytics dashboard, improved mobile experience, additional payment methods</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="text-teal-400 mt-1">✓</div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">Q2 2024</h3>
                    <p className="text-gray-300">Email marketing tools, affiliate program, subscription products support</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="text-teal-400 mt-1">→</div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">Q3 2024</h3>
                    <p className="text-gray-300">API access for developers, advanced customization options, multi-language support</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="text-teal-400 mt-1">→</div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">Q4 2024</h3>
                    <p className="text-gray-300">Mobile app, community features, advanced integrations</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Call to Action */}
            <section className="text-center bg-[#111111] rounded-2xl p-12 border border-gray-800">
              <h2 className="text-3xl font-bold text-white mb-4">Join Us</h2>
              <p className="text-lg text-gray-300 mb-8 max-w-2xl mx-auto">
                We&apos;re building the future of digital commerce, and we&apos;d love for you to be part of it. Whether you&apos;re a creator looking to sell or a customer looking to support creators, Saiflow is here for you.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href="/signup"
                  className="btn-primary"
                >
                  Start Selling
                </Link>
                <Link
                  href="/browse"
                  className="btn-secondary"
                >
                  Browse Products
                </Link>
              </div>
            </section>
          </article>
        </div>
      </section>
    </div>
  );
}

