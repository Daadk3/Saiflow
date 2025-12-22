import Link from "next/link";

// Documentation content (in a real app, this would come from a CMS or database)
interface DocContent {
  title: string;
  category: string;
  content: string;
}

const docs: Record<string, DocContent> = {
  "getting-started": {
    title: "Welcome to Saiflow",
    category: "Getting Started",
    content: `
      <h2>What is Saiflow?</h2>
      <p>Saiflow is a platform that makes it easy to sell digital products online. Whether you're selling ebooks, courses, templates, or any other digital content, Saiflow provides the tools you need to succeed.</p>
      
      <h2>Key Features</h2>
      <ul>
        <li>Easy product creation and management</li>
        <li>Beautiful, customizable storefronts</li>
        <li>Secure payment processing</li>
        <li>Analytics and insights</li>
        <li>Direct customer relationships</li>
      </ul>
      
      <h2>Next Steps</h2>
      <p>Ready to get started? Check out our guide on <a href="/docs/creating-account">creating your account</a>.</p>
    `,
  },
  "creating-account": {
    title: "Creating Your Account",
    category: "Getting Started",
    content: `
      <h2>Sign Up Process</h2>
      <p>Creating a Saiflow account is quick and easy:</p>
      <ol>
        <li>Click the "Sign Up" button in the top right corner</li>
        <li>Enter your email address and create a password</li>
        <li>Verify your email address</li>
        <li>Complete your profile</li>
      </ol>
      
      <h2>Account Types</h2>
      <p>Saiflow supports both seller and buyer accounts. You can switch between roles or use both features with a single account.</p>
    `,
  },
  "first-shop": {
    title: "Setting Up Your First Shop",
    category: "Getting Started",
    content: `
      <h2>Creating Your Shop</h2>
      <p>After creating your account, you can set up your first shop:</p>
      <ol>
        <li>Go to your dashboard</li>
        <li>Click "Create Shop"</li>
        <li>Choose a name and URL slug for your shop</li>
        <li>Add a description and logo</li>
        <li>Customize your shop's appearance</li>
      </ol>
      
      <h2>Shop Settings</h2>
      <p>You can customize various aspects of your shop including colors, fonts, and layout to match your brand.</p>
    `,
  },
  "creating-products": {
    title: "Creating Products",
    category: "For Sellers",
    content: `
      <h2>Adding a New Product</h2>
      <p>To create a new product:</p>
      <ol>
        <li>Navigate to your shop dashboard</li>
        <li>Click "Add Product"</li>
        <li>Fill in product details (name, description, price)</li>
        <li>Upload product files or set up download links</li>
        <li>Add product images</li>
        <li>Set product category and tags</li>
        <li>Publish your product</li>
      </ol>
      
      <h2>Product Types</h2>
      <p>Saiflow supports various digital product types including ebooks, courses, templates, software, and more.</p>
    `,
  },
  "pricing-strategy": {
    title: "Pricing Your Products",
    category: "For Sellers",
    content: `
      <h2>Pricing Best Practices</h2>
      <p>Setting the right price for your digital products is crucial for success:</p>
      <ul>
        <li>Research competitor pricing</li>
        <li>Consider the value you provide</li>
        <li>Test different price points</li>
        <li>Offer multiple tiers if applicable</li>
      </ul>
      
      <h2>Pricing Tools</h2>
      <p>Use Saiflow's analytics to track how different prices affect your sales and revenue.</p>
    `,
  },
  "managing-orders": {
    title: "Managing Orders",
    category: "For Sellers",
    content: `
      <h2>Order Dashboard</h2>
      <p>View and manage all your orders from the Orders section in your dashboard. You can see order details, customer information, and order status.</p>
      
      <h2>Order Status</h2>
      <p>Orders can have different statuses: pending, completed, or refunded. You'll receive notifications for new orders.</p>
    `,
  },
  "payouts": {
    title: "Payouts & Earnings",
    category: "For Sellers",
    content: `
      <h2>How Payouts Work</h2>
      <p>Earnings from your sales are automatically tracked in your dashboard. You can request payouts to your connected bank account or payment method.</p>
      
      <h2>Payout Schedule</h2>
      <p>Payouts are processed according to your account settings. Standard processing time is 2-5 business days.</p>
    `,
  },
  "analytics": {
    title: "Understanding Analytics",
    category: "For Sellers",
    content: `
      <h2>Analytics Dashboard</h2>
      <p>Saiflow provides comprehensive analytics to help you understand your sales performance:</p>
      <ul>
        <li>Revenue trends</li>
        <li>Product performance</li>
        <li>Customer insights</li>
        <li>Traffic sources</li>
      </ul>
    `,
  },
  "browsing-products": {
    title: "Browsing Products",
    category: "For Buyers",
    content: `
      <h2>Finding Products</h2>
      <p>Browse products by category, search by keyword, or explore featured shops. You can filter by price, category, and other criteria.</p>
      
      <h2>Product Pages</h2>
      <p>Each product page shows detailed information including description, images, price, and seller information.</p>
    `,
  },
  "making-purchase": {
    title: "Making a Purchase",
    category: "For Buyers",
    content: `
      <h2>Checkout Process</h2>
      <p>Purchasing a product is simple:</p>
      <ol>
        <li>Click "Buy Now" on the product page</li>
        <li>Review your order</li>
        <li>Enter payment information</li>
        <li>Complete the purchase</li>
      </ol>
      
      <h2>Payment Methods</h2>
      <p>We accept major credit cards and other secure payment methods.</p>
    `,
  },
  "downloads": {
    title: "Downloading Your Products",
    category: "For Buyers",
    content: `
      <h2>Accessing Downloads</h2>
      <p>After purchase, you'll receive an email with download links. You can also access your purchases from your account dashboard.</p>
      
      <h2>Download Limits</h2>
      <p>Most products allow multiple downloads. Check the product page for specific download policies.</p>
    `,
  },
  "refunds": {
    title: "Refund Policy",
    category: "For Buyers",
    content: `
      <h2>Refund Eligibility</h2>
      <p>Refund policies vary by product and seller. Most digital products are eligible for refunds within 30 days of purchase if you're not satisfied.</p>
      
      <h2>Requesting a Refund</h2>
      <p>To request a refund, contact the seller or use the refund request feature in your account dashboard.</p>
    `,
  },
  "general-faq": {
    title: "General Questions",
    category: "FAQ",
    content: `
      <h2>What is Saiflow?</h2>
      <p>Saiflow is a platform for selling and buying digital products online.</p>
      
      <h2>Is Saiflow free to use?</h2>
      <p>Creating an account is free. We charge a small transaction fee on sales.</p>
      
      <h2>What types of products can I sell?</h2>
      <p>You can sell any digital product including ebooks, courses, templates, software, and more.</p>
    `,
  },
  "seller-faq": {
    title: "Seller Questions",
    category: "FAQ",
    content: `
      <h2>How do I get paid?</h2>
      <p>Earnings are automatically tracked and can be withdrawn to your bank account.</p>
      
      <h2>What are the fees?</h2>
      <p>We charge a small transaction fee. See our pricing page for details.</p>
      
      <h2>Can I customize my shop?</h2>
      <p>Yes! You can customize colors, fonts, and layout to match your brand.</p>
    `,
  },
  "buyer-faq": {
    title: "Buyer Questions",
    category: "FAQ",
    content: `
      <h2>How do I download my purchase?</h2>
      <p>You'll receive an email with download links after purchase, or access them from your account.</p>
      
      <h2>What payment methods are accepted?</h2>
      <p>We accept major credit cards and other secure payment methods.</p>
      
      <h2>Can I get a refund?</h2>
      <p>Refund policies vary by product. Most products offer 30-day refunds.</p>
    `,
  },
  "technical-faq": {
    title: "Technical Support",
    category: "FAQ",
    content: `
      <h2>Having technical issues?</h2>
      <p>Contact our support team through the support page or email support@saiflow.com</p>
      
      <h2>Browser Requirements</h2>
      <p>Saiflow works best on modern browsers like Chrome, Firefox, Safari, and Edge.</p>
      
      <h2>Mobile Access</h2>
      <p>Yes, Saiflow is fully responsive and works on mobile devices.</p>
    `,
  },
};

const sidebarLinks = [
  {
    category: "Getting Started",
    links: [
      { slug: "getting-started", title: "Welcome to Saiflow" },
      { slug: "creating-account", title: "Creating Your Account" },
      { slug: "first-shop", title: "Setting Up Your First Shop" },
    ],
  },
  {
    category: "For Sellers",
    links: [
      { slug: "creating-products", title: "Creating Products" },
      { slug: "pricing-strategy", title: "Pricing Your Products" },
      { slug: "managing-orders", title: "Managing Orders" },
      { slug: "payouts", title: "Payouts & Earnings" },
      { slug: "analytics", title: "Understanding Analytics" },
    ],
  },
  {
    category: "For Buyers",
    links: [
      { slug: "browsing-products", title: "Browsing Products" },
      { slug: "making-purchase", title: "Making a Purchase" },
      { slug: "downloads", title: "Downloading Your Products" },
      { slug: "refunds", title: "Refund Policy" },
    ],
  },
  {
    category: "FAQ",
    links: [
      { slug: "general-faq", title: "General Questions" },
      { slug: "seller-faq", title: "Seller Questions" },
      { slug: "buyer-faq", title: "Buyer Questions" },
      { slug: "technical-faq", title: "Technical Support" },
    ],
  },
];

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const resolvedParams = await params;
  const doc = docs[resolvedParams.slug];

  if (!doc) {
    return (
      <div className="bg-[#0a0a0a] min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-4">Documentation Not Found</h1>
          <Link href="/docs" className="text-teal-400 hover:text-teal-300">
            Return to Documentation
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#0a0a0a] min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col lg:flex-row gap-12">
          {/* Sidebar */}
          <aside className="lg:w-64 flex-shrink-0">
            <div className="sticky top-24 space-y-8">
              <Link
                href="/docs"
                className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-6"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                Back to Docs
              </Link>

              {sidebarLinks.map((section) => (
                <div key={section.category}>
                  <h3 className="text-sm font-semibold text-white mb-3 uppercase tracking-wide">
                    {section.category}
                  </h3>
                  <ul className="space-y-2">
                    {section.links.map((link) => (
                      <li key={link.slug}>
                        <Link
                          href={`/docs/${link.slug}`}
                          className={`text-sm transition-colors ${
                            resolvedParams.slug === link.slug
                              ? "text-teal-400 font-medium"
                              : "text-gray-400 hover:text-white"
                          }`}
                        >
                          {link.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 max-w-4xl">
            <div className="mb-6">
              <span className="px-3 py-1 rounded-full text-sm font-semibold bg-teal-500/20 text-teal-400 border border-teal-500/30">
                {doc.category}
              </span>
            </div>
            <h1 className="text-4xl font-bold text-white mb-8">{doc.title}</h1>
            <article
              className="prose prose-invert prose-lg max-w-none
                prose-headings:text-white
                prose-p:text-gray-300
                prose-strong:text-white
                prose-a:text-teal-400
                prose-a:no-underline
                hover:prose-a:text-teal-300
                prose-ul:text-gray-300
                prose-li:text-gray-300
                prose-ol:text-gray-300
                prose-code:text-teal-400
                prose-pre:bg-gray-900
                prose-pre:border
                prose-pre:border-gray-800"
              dangerouslySetInnerHTML={{ __html: doc.content }}
            />
          </main>
        </div>
      </div>
    </div>
  );
}

