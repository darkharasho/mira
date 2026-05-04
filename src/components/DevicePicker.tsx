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
      <span className="text-xs uppercase tracking-wider text-white/50">{label}</span>
      <select
        className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm
                   focus:outline-none focus:ring-1 focus:ring-white/30 disabled:opacity-50"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>Select…</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
