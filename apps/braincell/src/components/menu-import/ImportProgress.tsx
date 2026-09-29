import { motion } from 'framer-motion';
import { SparklesIcon } from '@heroicons/react/24/outline';

export default function ImportProgress({
  title,
  subtitle,
  done,
  total,
}: {
  title: string;
  subtitle?: string;
  done: number;
  total: number;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-[#e5e5e5] bg-white p-8 text-center shadow-sm">
      <motion.div
        animate={{ rotate: [0, 12, -12, 0] }}
        transition={{ repeat: Infinity, duration: 2.4 }}
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#f3f3f3]"
      >
        <SparklesIcon className="h-6 w-6 text-[#2e2e30]" />
      </motion.div>
      <h3 className="text-lg font-semibold text-[#2e2e30]">{title}</h3>
      {subtitle && <p className="mt-1 text-sm text-[#6b6b70]">{subtitle}</p>}
      <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-[#eeeeee]">
        <motion.div
          className="h-full rounded-full bg-[#2e2e30]"
          initial={false}
          animate={{ width: `${Math.max(pct, 4)}%` }}
          transition={{ ease: 'easeOut', duration: 0.4 }}
        />
      </div>
      <p className="mt-2 text-xs text-[#6b6b70]">{pct}%</p>
    </div>
  );
}
