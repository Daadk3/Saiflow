import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";

// Sample blog posts data (in a real app, this would come from a database or CMS)
const blogPosts: Record<string, any> = {
  "introducing-saiflow": {
    slug: "introducing-saiflow",
    title: "Introducing Saiflow: The Future of Digital Product Sales",
    content: `
      <p>We're thrilled to announce the launch of Saiflow, a platform designed to revolutionize how creators sell digital products online.</p>
      
      <h2>Our Mission</h2>
      <p>At Saiflow, we believe that creators should keep more of what they earn. Traditional marketplaces take significant cuts, leaving creators with less than they deserve. We're changing that.</p>
      
      <h2>What Makes Us Different</h2>
      <p>Unlike other platforms, Saiflow offers:</p>
      <ul>
        <li>Lower transaction fees - keep more of your revenue</li>
        <li>Beautiful, customizable storefronts</li>
        <li>Seamless checkout experience</li>
        <li>Powerful analytics to track your sales</li>
        <li>Direct customer relationships</li>
      </ul>
      
      <h2>Getting Started</h2>
      <p>Ready to start selling? Creating your first shop takes just minutes. Sign up today and join thousands of creators who are already using Saiflow to monetize their digital products.</p>
    `,
    author: "Saiflow Team",
    date: "2024-01-15",
    category: "Product",
    featuredImage: "/mascot.png",
    readTime: "5 min read",
  },
  "creator-tips-pricing": {
    slug: "creator-tips-pricing",
    title: "5 Tips for Pricing Your Digital Products",
    content: `
      <p>Pricing is one of the most critical decisions you'll make as a digital product creator. Get it right, and you'll maximize revenue while keeping customers happy. Get it wrong, and you could leave money on the table or price yourself out of the market.</p>
      
      <h2>1. Research Your Competition</h2>
      <p>Before setting your price, research what similar products are selling for. Look at direct competitors and products in adjacent categories. This gives you a baseline understanding of market expectations.</p>
      
      <h2>2. Consider Your Value Proposition</h2>
      <p>Price based on the value you provide, not just your costs. If your product solves a significant problem or saves customers time, it's worth more. Don't undervalue your work.</p>
      
      <h2>3. Test Different Price Points</h2>
      <p>Don't be afraid to experiment. Try different prices and see how they affect sales volume and revenue. Sometimes a higher price can actually increase sales by signaling quality.</p>
      
      <h2>4. Offer Multiple Tiers</h2>
      <p>Consider offering different versions of your product at different price points. This allows customers to choose what fits their budget while maximizing your revenue potential.</p>
      
      <h2>5. Factor in Your Time</h2>
      <p>Remember that your time has value. If you spent 100 hours creating a course, don't price it at $10 just because it's digital. Your expertise and effort deserve fair compensation.</p>
    `,
    author: "Sarah Chen",
    date: "2024-01-10",
    category: "Tips",
    featuredImage: "/mascot.png",
    readTime: "7 min read",
  },
  "building-audience": {
    slug: "building-audience",
    title: "How to Build an Audience Before Launching Your First Product",
    content: `
      <p>One of the biggest mistakes new creators make is launching a product without an audience. Building an audience first dramatically increases your chances of success.</p>
      
      <h2>Start with Content</h2>
      <p>Create valuable content related to your niche. This could be blog posts, videos, social media posts, or podcasts. The key is consistency and providing real value.</p>
      
      <h2>Engage Authentically</h2>
      <p>Don't just broadcast - engage. Reply to comments, join conversations, and build genuine relationships. People buy from people they know, like, and trust.</p>
      
      <h2>Build an Email List</h2>
      <p>Email is still one of the most powerful marketing channels. Start collecting emails early, even before you have a product to sell. Offer value in exchange for email addresses.</p>
      
      <h2>Leverage Social Media</h2>
      <p>Choose 1-2 social platforms where your audience hangs out and focus on building a presence there. It's better to be great on one platform than mediocre on many.</p>
      
      <h2>Be Patient</h2>
      <p>Building an audience takes time. Don't get discouraged if growth is slow at first. Focus on providing value, and the audience will come.</p>
    `,
    author: "Mike Johnson",
    date: "2024-01-05",
    category: "Marketing",
    featuredImage: "/mascot.png",
    readTime: "6 min read",
  },
  "platform-updates-january": {
    slug: "platform-updates-january",
    title: "Platform Updates: New Features and Improvements",
    content: `
      <p>We've been hard at work improving Saiflow based on your feedback. Here's what's new this month:</p>
      
      <h2>Enhanced Analytics</h2>
      <p>We've completely redesigned the analytics dashboard with more detailed insights into your sales, customer behavior, and product performance.</p>
      
      <h2>Improved Checkout Flow</h2>
      <p>The checkout process is now faster and more intuitive, reducing cart abandonment and improving conversion rates.</p>
      
      <h2>New Payment Options</h2>
      <p>We've added support for additional payment methods, making it easier for customers worldwide to purchase your products.</p>
      
      <h2>Better Mobile Experience</h2>
      <p>Storefronts now look and work better on mobile devices, ensuring your customers have a great experience no matter how they shop.</p>
      
      <h2>What's Next</h2>
      <p>We're working on email marketing tools, advanced customization options, and more. Stay tuned for updates!</p>
    `,
    author: "Saiflow Team",
    date: "2024-01-01",
    category: "Updates",
    featuredImage: "/mascot.png",
    readTime: "4 min read",
  },
};

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const resolvedParams = await params;
  const post = blogPosts[resolvedParams.slug];

  if (!post) {
    notFound();
  }

  return (
    <div className="bg-[#0a0a0a] min-h-screen">
      {/* Header */}
      <section className="border-b border-gray-800 bg-[#0a0a0a] py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-8"
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
            Back to Blog
          </Link>

          <div className="mb-4">
            <span className="px-3 py-1 rounded-full text-sm font-semibold bg-teal-500/20 text-teal-400 border border-teal-500/30">
              {post.category}
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6">
            {post.title}
          </h1>

          <div className="flex items-center gap-4 text-gray-400">
            <span>By {post.author}</span>
            <span>•</span>
            <span>{post.date}</span>
            <span>•</span>
            <span>{post.readTime}</span>
          </div>
        </div>
      </section>

      {/* Featured Image */}
      <section className="py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative w-full h-96 bg-gray-800 rounded-2xl overflow-hidden">
            <Image
              src={post.featuredImage}
              alt={`Featured image for ${post.title} - ${post.category} article on Saiflow blog`}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 1200px"
            />
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
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
              prose-code:text-teal-400
              prose-pre:bg-gray-900
              prose-pre:border
              prose-pre:border-gray-800"
            dangerouslySetInnerHTML={{ __html: post.content }}
          />
        </div>
      </section>
    </div>
  );
}

