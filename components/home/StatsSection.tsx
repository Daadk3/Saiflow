import { useTranslations } from 'next-intl';

export function StatsSection() {
  const t = useTranslations('stats');
  const stats = [
    { icon: '🎉', label: t('badge1') },
    { icon: '⚡', label: t('badge2') },
    { icon: '🇸🇦', label: t('badge3') },
    { icon: '🌐', label: t('badge4') },
  ];

  return (
    <section className="bg-[#0a0a0a] border-y border-gray-800 py-6 px-4">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex items-center justify-center gap-3 rounded-xl bg-[#111111] shadow-sm border border-gray-800 px-4 py-3"
            >
              <span className="text-lg">{stat.icon}</span>
              <div className="text-start">
                <p className="text-sm text-gray-400">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

