export function FeaturesSection() {
  const steps = [
    {
      title: "Create your shop",
      desc: "Set up your storefront in minutes with a clean, branded checkout.",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h10M4 18h6" />
        </svg>
      ),
    },
    {
      title: "Upload products",
      desc: "Add courses, ebooks, templates, music, or any digital file to sell instantly.",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      ),
    },
    {
      title: "Get paid",
      desc: "Accept payments globally with secure checkout and instant delivery.",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M5 12a7 7 0 1114 0 7 7 0 01-14 0z" />
        </svg>
      ),
    },
  ];

  return (
    <section className="py-16 sm:py-20 px-4 bg-[#0a0a0a]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <p className="text-sm font-semibold text-teal-400 uppercase tracking-wide">How it works</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mt-2">Launch in three simple steps</h2>
          <p className="mt-3 text-lg text-gray-400">
            Create, upload, and start earning with a modern Gumroad-like experience.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((step, idx) => (
            <div
              key={step.title}
              className="rounded-2xl border border-gray-800 bg-[#111111] p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md hover:border-gray-700"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="h-12 w-12 rounded-xl bg-teal-500/10 text-teal-400 flex items-center justify-center">
                  {step.icon}
                </div>
                <span className="text-xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-teal-300 tracking-wider uppercase">
                  Step {idx + 1}
                </span>
              </div>
              <h3 className="text-xl font-semibold text-white">{step.title}</h3>
              <p className="mt-2 text-gray-400 leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
