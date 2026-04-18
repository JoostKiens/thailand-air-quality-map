interface Props {
  value: number;
  category: string;
  color: string;
}

export function AqiBadge({ value, category, color }: Props) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded text-white"
      style={{ backgroundColor: color }}
    >
      <span>{value}</span>
      <span className="opacity-80">{category}</span>
    </span>
  );
}
