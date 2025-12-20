import Link from "next/link";

const docCategories = [
  {
    title: "Getting Started",
    description: "New to Saiflow? Start here",
    icon: "🚀",
    docs: [
      { slug: "getting-started", title: "Welcome to Saiflow" },
      { slug: "creating-account", title: "Creating Your Account" },
      { slug: "first-shop", title: "Setting Up Your First Shop" },
    ],
  },
  {
    title: "For Sellers",
    description: "Everything you need to sell digital products",
    icon: "💼",
    docs: [
      { slug: "creating-products", title: "Creating Products" },
      { slug: "pricing-strategy", title: "Pricing Your Products" },
      { slug: "managing-orders", title: "Managing Orders" },
      { slug: "payouts", title: "Payouts & Earnings" },
      { slug: "analytics", title: "Understanding Analytics" },
    ],
  },
  {
    title: "For Buyers",
    description: "How to purchase and download products",
    icon: "🛒",
    docs: [
      { slug: "browsing-products", title: "Browsing Products" },
      { slug: "making-purchase", title: "Making a Purchase" },
      { slug: "downloads", title: "Downloading Your Products" },
      { slug: "refunds", title: "Refund Policy" },
    ],
  },
  {
    title: "FAQ",
    description: "Frequently asked questions",
    icon: "❓",
    docs: [
      { slug: "general-faq", title: "General Questions" },
      { slug: "seller-faq", title: "Seller Questions" },
      { slug: "buyer-faq", title: "Buyer Questions" },
      { slug: "technical-faq", title: "Technical Support" },
    ],
  },
];

export default function DocsPage() {
  return (
    <div className="bg-[#0a0a0a] min-h-screen">
      {/* Header */}
      <section className="border-b border-gray-800 bg-[#0a0a0a] py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              Documentation
            </h1>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Everything you need to know about using Saiflow
            </p>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {docCategories.map((category) => (
              <div
                key={category.title}
                className="bg-[#111111] rounded-2xl border border-gray-800 p-6 hover:border-teal-500/50 transition-all duration-300"
              >
                <div className="text-4xl mb-4">{category.icon}</div>
                <h2 className="text-xl font-semibold text-white mb-2">
                  {category.title}
                </h2>
                <p className="text-gray-400 text-sm mb-4">
                  {category.description}
                </p>
                <ul className="space-y-2">
                  {category.docs.map((doc) => (
                    <li key={doc.slug}>
                      <Link
                        href={`/docs/${doc.slug}`}
                        className="text-sm text-gray-400 hover:text-teal-400 transition-colors"
                      >
                        {doc.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Quick Links */}
          <div className="mt-16 bg-[#111111] rounded-2xl border border-gray-800 p-8">
            <h2 className="text-2xl font-semibold text-white mb-6">
              Quick Links
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Link
                href="/docs/getting-started"
                className="p-4 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
              >
                <h3 className="font-semibold text-white mb-2">
                  Getting Started Guide
                </h3>
                <p className="text-sm text-gray-400">
                  New to Saiflow? Start with our comprehensive getting started
                  guide.
                </p>
              </Link>
              <Link
                href="/docs/creating-products"
                className="p-4 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
              >
                <h3 className="font-semibold text-white mb-2">
                  Creating Products
                </h3>
                <p className="text-sm text-gray-400">
                  Learn how to create and manage your digital products.
                </p>
              </Link>
              <Link
                href="/docs/general-faq"
                className="p-4 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
              >
                <h3 className="font-semibold text-white mb-2">FAQ</h3>
                <p className="text-sm text-gray-400">
                  Find answers to the most commonly asked questions.
                </p>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

