/**
 * Thin animated line shown at the bottom edge of TopBar while any mutation is active
 */
import { useProgress } from '../../context/ProgressContext';

export default function TopbarProgress() {
  const { active } = useProgress();

  return (
    <div className="absolute left-0 right-0 bottom-0 h-[2px]">
      <div
        className="relative h-full overflow-hidden"
        style={{ opacity: active ? 1 : 0, transition: 'opacity 120ms ease' }}
        aria-hidden={!active}
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(90deg, rgba(99,102,241,0) 0%, rgba(99,102,241,0.9) 50%, rgba(99,102,241,0) 100%)',
            backgroundSize: '200% 100%',
            animation: 'topbar-progress-move 1.2s linear infinite',
          }}
        />
      </div>
      <style>
        {`
        @keyframes topbar-progress-move {
          0% { background-position: 0% 0; }
          100% { background-position: 200% 0; }
        }
      `}
      </style>
    </div>
  );
}