export function StatsSection() {
  const stats = [
    { label: "Creators", value: "10,000+", icon: "👩‍🎨" },
    { label: "Products", value: "50,000+", icon: "📦" },
    { label: "Earned", value: "$1M+", icon: "💸" },
  ];

  return (
    <section className="bg-[#0a0a0a] border-y border-gray-800 py-6 px-4">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex items-center justify-center gap-3 rounded-xl bg-[#111111] shadow-sm border border-gray-800 px-4 py-3"
            >
              <span className="text-lg">{stat.icon}</span>
              <div className="text-left">
                <p className="text-sm text-gray-400">{stat.label}</p>
                <p className="text-lg font-semibold text-white">{stat.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

