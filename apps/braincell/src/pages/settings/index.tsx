import { Link } from 'react-router-dom';

export default function SettingsOverview(): JSX.Element {
  const cards = [
    { title: 'Plan & Billing', desc: 'Choose plan, billing cycle, and manage payment.', to: '/settings/plan' },
    { title: 'Branding', desc: 'Name, logo, theme colors.', to: '/settings/branding' },
    { title: 'Domain', desc: 'Custom domain & DNS verification.', to: '/settings/domain' },
    { title: 'Security', desc: '2FA, SSO, sessions.', to: '/settings/security' },
    { title: 'Notifications', desc: 'Email, push & SMS alerts.', to: '/settings/notifications' },
    { title: 'Integrations', desc: 'Stripe, Slack, Google Analytics.', to: '/settings/integrations' },
    { title: 'API & Webhooks', desc: 'Keys, rotate & test webhooks.', to: '/settings/developer' },
    { title: 'Team & Roles', desc: 'Invite users and assign roles.', to: '/settings/team' },
    { title: 'Restaurant Access', desc: 'One email login. Bind devices to locations automatically.', to: '/settings/access' }, // NEW
    { title: 'Localization', desc: 'Currency, timezone & formats.', to: '/settings/localization' },
    { title: 'Accessibility', desc: 'Motion, contrast & font scale.', to: '/settings/accessibility' },
    { title: 'Labs', desc: 'Experimental features toggle.', to: '/settings/labs' },
    { title: 'Data & Privacy', desc: 'Export and delete data.', to: '/settings/privacy' },
    { title: 'Audit Log', desc: 'Recent admin activity.', to: '/settings/audit' },

    // NEW: direct link to the Bangla TTS Lab outside of /settings/*
    { title: 'Bangla TTS (Lab)', desc: 'Type Bangla and hear the voice output.', to: '/labs/tts' },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <Link
          key={c.to}
          to={c.to}
          className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm transition hover:shadow-md"
        >
          <div className="text-[14px] font-semibold text-slate-900">{c.title}</div>
          <div className="mt-1 text-[12px] text-slate-600">{c.desc}</div>
        </Link>
      ))}
    </div>
  );
}
