import Link from "next/link";

const categories = [
  { name: "eBooks & Guides", slug: "ebooks", icon: "📘" },
  { name: "Online Courses", slug: "courses", icon: "🎥" },
  { name: "Templates & Themes", slug: "templates", icon: "🧩" },
  { name: "Music & Audio", slug: "music", icon: "🎵" },
  { name: "Art & Graphics", slug: "art", icon: "🎨" },
  { name: "Software & Apps", slug: "software", icon: "💻" },
];

export function CategoriesSection() {
  return (
    <section className="py-16 sm:py-20 px-4 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <p className="text-sm font-semibold text-teal-700 uppercase tracking-wide">
            Explore by category
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mt-2">
            Find the right digital product
          </h2>
          <p className="mt-3 text-lg text-gray-600">
            From courses to templates, discover what creators are selling.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {categories.map((category) => (
            <Link
              key={category.slug}
              href={`/browse?category=${category.slug}`}
              className="group rounded-xl border border-gray-100 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-50 text-2xl">
                  {category.icon}
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {category.name}
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Explore the latest in {category.name.toLowerCase()}.
                  </p>
                </div>
              </div>
              <div className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-teal-700">
                Browse category
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 transition-transform group-hover:translate-x-1"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
