export function StatsSection() {
  const stats = [
    { label: "Creators", value: "10,000+", icon: "👩‍🎨" },
    { label: "Products", value: "50,000+", icon: "📦" },
    { label: "Earned", value: "$1M+", icon: "💸" },
  ];

  return (
    <section className="bg-teal-50 border-y border-teal-100 py-6 px-4">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex items-center justify-center gap-3 rounded-xl bg-white shadow-sm border border-gray-100 px-4 py-3"
            >
              <span className="text-lg">{stat.icon}</span>
              <div className="text-left">
                <p className="text-sm text-gray-500">{stat.label}</p>
                <p className="text-lg font-semibold text-gray-900">{stat.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

