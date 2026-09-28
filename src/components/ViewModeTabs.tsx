export function ViewModeTabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="view-mode-tabs flex gap-1 border border-cyber-border rounded-button overflow-hidden">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`view-mode-tab px-3 py-1.5 text-sm font-mono transition-colors ${
            value === option.value
              ? 'bg-cyber-elevated text-cyber-text'
              : 'text-cyber-text-secondary hover:text-cyber-text'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
