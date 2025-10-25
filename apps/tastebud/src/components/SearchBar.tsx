import React from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: (v: string) => void;
  className?: string;
  placeholder?: string;
};

export default function SearchBar({
  value,
  onChange,
  onSubmit,
  className,
  placeholder = "Search Food with AI",
}: Props) {
  const ref = React.useRef<HTMLInputElement>(null);

  return (
    <div
      className={[
        "w-full rounded-full bg-white",
        "shadow-[0_1px_4px_rgba(0,0,0,0.06)]",
        "transition-all duration-200",
        // removed focus shadow
        className || "",
      ].join(" ")}
      onClick={() => ref.current?.focus()}
      role="search"
      aria-label="Search menu"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.(value);
        }}
        className="flex items-center gap-4 px-6 h-14 sm:h-16"
      >
        {/* icon */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-7 w-7 sm:h-8 sm:w-8 flex-none text-gray-400"
        >
          <path
            fill="currentColor"
            d="M10.5 3a7.5 7.5 0 0 1 5.9 12.2l3.7 3.7a1.25 1.25 0 1 1-1.8 1.8l-3.7-3.7A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"
          />
        </svg>

        <input
          ref={ref}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={[
            "w-full bg-transparent outline-none",
            "text-[14px] sm:text-[15px] text-gray-900 placeholder:text-gray-400",
            "font-[Inter]",
          ].join(" ")}
          aria-label={placeholder}
          autoComplete="off"
          spellCheck={false}
        />

        {/* clear button */}
        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              ref.current?.focus();
            }}
            className="rounded-full px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Clear search"
          >
            Clear
          </button>
        ) : null}
      </form>
    </div>
  );
}
