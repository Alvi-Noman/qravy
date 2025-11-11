import React from 'react';

export default function RestaurantSkeleton() {
  return (
    <div className="animate-pulse font-[Inter]" aria-hidden="true">
      {/* Category pills — slightly larger for balance */}
      <div className="sticky top-0 z-10 mb-5 bg-[#F6F5F8] pb-4 pt-3">
        <div
          className="flex gap-3 overflow-x-auto"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <style>{`div::-webkit-scrollbar{display:none}`}</style>

          {/* Wider, taller, more natural chip widths */}
          {[
            'w-[100px]',
            'w-[120px]',
            'w-[136px]',
            'w-[112px]',
            'w-[140px]',
            'w-[125px]',
          ].map((w, i) => (
            <div
              key={i}
              className={`h-8 ${w} rounded-full bg-white shadow-sm`}
              style={{ flexShrink: 0 }}
            />
          ))}
        </div>
      </div>

      {/* Product grid — very round cards (premium feel) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-[150px] sm:h-[160px] rounded-[2rem] bg-gray-200"
          />
        ))}
      </div>
    </div>
  );
}
