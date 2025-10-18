import React, { useEffect, useRef } from 'react';

type CounterProps = {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  inputWidthClass?: string;
  ariaLabel?: string;
};

const Counter: React.FC<CounterProps> = ({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  disabled,
  className = '',
  inputWidthClass = 'w-20',
  ariaLabel = 'Counter',
}) => {
  const repeatRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const clamp = (n: number) => (typeof max === 'number' ? Math.min(Math.max(n, min), max) : Math.max(n, min));
  const changeBy = (d: number) => { if (!disabled) onChange(clamp(value + d)); };

  const startHold = (d: number) => {
    if (disabled) return;
    changeBy(d);
    timeoutRef.current = window.setTimeout(() => { repeatRef.current = window.setInterval(() => changeBy(d), 80); }, 350);
  };
  const stopHold = () => {
    if (timeoutRef.current !== null) { window.clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (repeatRef.current !== null) { window.clearInterval(repeatRef.current); repeatRef.current = null; }
  };
  useEffect(() => () => stopHold(), []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); changeBy(step); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); changeBy(-step); }
    else if (e.key === 'PageUp') { e.preventDefault(); changeBy(step * 10); }
    else if (e.key === 'PageDown') { e.preventDefault(); changeBy(-step * 10); }
    else if (e.key === 'Home' && typeof min === 'number') { e.preventDefault(); onChange(min); }
    else if (e.key === 'End' && typeof max === 'number') { e.preventDefault(); onChange(max); }
  };

  const parsed = Number.isFinite(value) ? String(value) : '';
  const minusDisabled = disabled || value <= min;
  const plusDisabled = disabled || (typeof max === 'number' ? value >= max : false);

  const btn =
    'flex items-center justify-center leading-none w-10 select-none px-0 py-2 ' +
    'border border-[#dbdbdb] bg-[#fcfcfc] hover:bg-[#f6f6f6] ' +
    'disabled:opacity-50 disabled:cursor-not-allowed text-[#2e2e30]';

  return (
    <div className={`inline-flex items-stretch rounded-md ${className}`}>
      <button type="button" aria-label="Decrease" className={`${btn} rounded-l-md border-r-0`} onMouseDown={() => startHold(-step)} onMouseUp={stopHold} onMouseLeave={stopHold} onTouchStart={() => startHold(-step)} onTouchEnd={stopHold} disabled={minusDisabled}>−</button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={ariaLabel}
        role="spinbutton"
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={typeof max === 'number' ? max : undefined}
        className={`text-center border border-[#dbdbdb] hover:border-[#111827] focus:border-[#111827] transition-colors ${inputWidthClass} px-3 py-2 text-sm placeholder-[#a9a9ab] focus:outline-none focus:ring-0 bg-[#fcfcfc] text-[#2e2e30]`}
        value={parsed}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return onChange(min);
          const n = Number(raw);
          if (!Number.isNaN(n)) onChange(clamp(Math.floor(n)));
        }}
        onKeyDown={onKeyDown}
        disabled={disabled}
      />
      <button type="button" aria-label="Increase" className={`${btn} rounded-r-md border-l-0`} onMouseDown={() => startHold(step)} onMouseUp={stopHold} onMouseLeave={stopHold} onTouchStart={() => startHold(step)} onTouchEnd={stopHold} disabled={plusDisabled}>+</button>
    </div>
  );
};

export default Counter;