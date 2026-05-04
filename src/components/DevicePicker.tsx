type Option = { value: string; label: string };

export function DevicePicker({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  options: Option[];
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.14em] text-zinc-400 font-medium">
        {label}
      </span>
      <div className="relative mt-1.5">
        <select
          className="appearance-none w-full rounded-lg bg-zinc-900/80 border border-white/10
                     px-3 py-2 pr-8 text-sm text-zinc-100
                     focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent/40
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors hover:border-white/20"
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="" disabled>Select…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-zinc-900 text-zinc-100">
              {o.label}
            </option>
          ))}
        </select>
        <svg
          className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none"
          viewBox="0 0 12 12"
          fill="none"
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </label>
  );
}
