import React from 'react';

export type Section = { id: string; name: string };

type Props = {
  sections: Section[];
  activeId: string;
  onJump: (id: string) => void;
};

export default function CategoryList({ sections, activeId, onJump }: Props) {
  if (!sections?.length) return null;

  return (
    <div className="sticky top-0 z-10 mb-5 bg-[#F6F5F8] pb-4 pt-3 font-[Inter]">
      <div
        className="flex gap-3 overflow-x-auto"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {/* hide scrollbar inline (scoped to this div) */}
        <style>{`
          div::-webkit-scrollbar { display: none; }
        `}</style>

        {sections.map((s) => {
          const active = s.id === activeId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onJump(s.id);
                const el = document.getElementById(s.id);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={[
                'whitespace-nowrap rounded-full px-5 py-1.5 text-sm font-medium transition-all duration-200 transform',
                active
                  ? 'bg-[#FA2851] text-white shadow-md'
                  : 'bg-white text-gray-800 hover:shadow-sm hover:scale-[1.03]',
              ].join(' ')}
            >
              {s.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
