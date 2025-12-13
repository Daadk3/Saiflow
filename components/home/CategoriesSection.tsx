import Link from "next/link";

const categories = [
  { name: "eBooks & Guides", slug: "ebooks-guides", icon: "📘" },
  { name: "Online Courses", slug: "online-courses", icon: "🎥" },
  { name: "Templates & Themes", slug: "templates-themes", icon: "🧩" },
  { name: "Music & Audio", slug: "music-audio", icon: "🎵" },
  { name: "Art & Graphics", slug: "art-graphics", icon: "🎨" },
  { name: "Software & Apps", slug: "software-apps", icon: "💻" },
];

export function CategoriesSection() {
  return (
    <section className="py-16 sm:py-24 px-4 bg-[#0a0a0a]">
      <div className="max-w-full px-4 sm:px-8 lg:px-16 xl:px-24 mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-3">
            Discover Amazing Products
          </h2>
          <p className="text-lg text-gray-400">Browse by category</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {categories.map((category) => (
            <Link
              key={category.slug}
              href={`/browse?category=${encodeURIComponent(category.slug)}`}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#111111] p-6 transition-transform duration-200 hover:-translate-y-1 hover:border-teal-500/60"
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <div className="absolute inset-0 bg-gradient-to-br from-teal-500/10 via-[#FF6B9D]/8 to-[#9D4EDD]/10 blur-3xl" />
              </div>
              <div className="relative flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 text-2xl">
                  {category.icon}
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-white mb-2">
                    {category.name}
                  </h3>
                  <p className="text-sm text-gray-500">
                    Explore the latest in {category.name.toLowerCase()}.
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
