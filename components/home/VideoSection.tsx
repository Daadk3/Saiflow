export function VideoSection() {
  return (
    <section className="py-20 sm:py-32 px-4 relative overflow-hidden">
      {/* Background glow effect */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-full max-w-4xl h-96 bg-teal-500/10 blur-[120px] rounded-full"></div>
      </div>

      <div className="max-w-full px-4 sm:px-8 lg:px-16 xl:px-24 mx-auto relative z-10">
        {/* Section Header */}
        <div className="text-center mb-12">
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-4">
            From Creation to Cash
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Watch how easy it is to start selling your digital products
          </p>
        </div>

        {/* Video Player */}
        <div className="max-w-[800px] mx-auto">
          <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/50 bg-[#0A0A0A]">
            {/* Glow effect around video */}
            <div className="absolute -inset-1 bg-gradient-to-r from-teal-500/20 to-cyan-500/20 rounded-2xl blur-xl opacity-50"></div>

            {/* YouTube Embed */}
            <div className="relative w-full aspect-video">
              <iframe
                src="https://www.youtube.com/embed/KwRwMTCCT4k"
                className="absolute top-0 left-0 w-full h-full rounded-2xl"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
