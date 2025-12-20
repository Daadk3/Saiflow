import Link from "next/link";
import Image from "next/image";

// Sample blog posts data
const blogPosts = [
  {
    slug: "introducing-saiflow",
    title: "Introducing Saiflow: The Future of Digital Product Sales",
    excerpt: "We're excited to launch Saiflow, a platform designed to help creators sell digital products with ease. Learn about our mission and what makes us different.",
    author: "Saiflow Team",
    date: "2024-01-15",
    category: "Product",
    featuredImage: "/mascot.png",
    readTime: "5 min read",
  },
  {
    slug: "creator-tips-pricing",
    title: "5 Tips for Pricing Your Digital Products",
    excerpt: "Pricing can make or break your digital product business. Here are proven strategies to price your products for maximum revenue and customer satisfaction.",
    author: "Sarah Chen",
    date: "2024-01-10",
    category: "Tips",
    featuredImage: "/mascot.png",
    readTime: "7 min read",
  },
  {
    slug: "building-audience",
    title: "How to Build an Audience Before Launching Your First Product",
    excerpt: "Building an audience is crucial for product success. Discover strategies to grow your following and create a community around your brand.",
    author: "Mike Johnson",
    date: "2024-01-05",
    category: "Marketing",
    featuredImage: "/mascot.png",
    readTime: "6 min read",
  },
  {
    slug: "platform-updates-january",
    title: "Platform Updates: New Features and Improvements",
    excerpt: "We've been working hard to improve Saiflow. Check out the latest features including enhanced analytics, better checkout flows, and more.",
    author: "Saiflow Team",
    date: "2024-01-01",
    category: "Updates",
    featuredImage: "/mascot.png",
    readTime: "4 min read",
  },
];

const categories = ["All", "Product", "Tips", "Marketing", "Updates"];

export default function BlogPage() {
  return (
    <div className="bg-[#0a0a0a] min-h-screen">
      {/* Header */}
      <section className="border-b border-gray-800 bg-[#0a0a0a] py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              Saiflow Blog
            </h1>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Tips, updates, and insights for digital creators and entrepreneurs
            </p>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Categories */}
          <div className="flex flex-wrap gap-3 mb-12 justify-center">
            {categories.map((category) => (
              <button
                key={category}
                className="px-4 py-2 rounded-full text-sm font-medium transition-colors bg-gray-800 text-gray-300 hover:bg-teal-500 hover:text-white"
              >
                {category}
              </button>
            ))}
          </div>

          {/* Blog Posts Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {blogPosts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="group bg-[#111111] rounded-2xl border border-gray-800 hover:border-teal-500/50 transition-all duration-300 hover:-translate-y-1 overflow-hidden"
              >
                {/* Featured Image */}
                <div className="relative w-full h-48 bg-gray-800 overflow-hidden">
                  <Image
                    src={post.featuredImage}
                    alt={`Featured image for ${post.title} - ${post.category} article on Saiflow blog`}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  />
                  <div className="absolute top-3 left-3">
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-teal-500/90 text-white">
                      {post.category}
                    </span>
                  </div>
                </div>

                {/* Content */}
                <div className="p-6">
                  <div className="flex items-center gap-3 text-sm text-gray-400 mb-3">
                    <span>{post.date}</span>
                    <span>•</span>
                    <span>{post.readTime}</span>
                  </div>
                  <h2 className="text-xl font-semibold text-white mb-2 group-hover:text-teal-400 transition-colors line-clamp-2">
                    {post.title}
                  </h2>
                  <p className="text-gray-400 text-sm line-clamp-3 mb-4">
                    {post.excerpt}
                  </p>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <span>By {post.author}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

