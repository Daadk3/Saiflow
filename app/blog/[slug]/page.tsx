import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";

interface BlogPost {
  slug: string;
  title: string;
  content: string;
  author: string;
  date: string;
  category: string;
  featuredImage: string;
  readTime: string;
}

// Sample blog posts data (in a real app, this would come from a database or CMS)
const blogPosts: Record<string, BlogPost> = {
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
        <li>Transparent pricing — details coming before launch</li>
        <li>Beautiful, customizable storefronts</li>
        <li>Seamless checkout experience</li>
        <li>Powerful analytics to track your sales</li>
        <li>Direct customer relationships</li>
      </ul>
      
      <h2>Getting Started</h2>
      <p>Ready to start selling? Creating your first shop takes just minutes. Sign up today and join thousands of creators who are already using Saiflow to monetize their digital products.</p>
    `,
    author: "Saiflow Team",
    date: "2026-07-01",
    category: "Product",
    featuredImage: "/mascot.png",
    readTime: "5 min read",
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

