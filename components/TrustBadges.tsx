import { useTranslations } from 'next-intl';

export default function TrustBadges() {
  const t = useTranslations('trustBadges');
  const badges = [
    { icon: '🔒', title: t('secureTitle'), subtitle: t('secureSubtitle') },
    { icon: '⚡', title: t('deliveryTitle'), subtitle: t('deliverySubtitle') },
    { icon: '🇸🇦', title: t('saudiTitle'), subtitle: t('saudiSubtitle') },
    { icon: '💬', title: t('supportTitle'), subtitle: t('supportSubtitle') },
  ];

  return (
    <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {badges.map((badge) => (
          <div key={badge.title} className="flex flex-col items-center text-center">
            <span aria-hidden="true" className="text-3xl mb-2">{badge.icon}</span>
            <p className="text-sm font-semibold text-white">{badge.title}</p>
            <p className="text-xs text-gray-400 mt-1">{badge.subtitle}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
