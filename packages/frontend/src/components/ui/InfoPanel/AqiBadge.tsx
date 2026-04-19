import { contrastColor, pm25ToRgb } from '../../../lib/aqiColors';

interface Props {
  value: number;
  category: string;
}

export function AqiBadge({ value, category }: Props) {
  const rgb = pm25ToRgb(value);
  const [tr, tg, tb] = contrastColor(rgb);
  const bg = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  const text = `rgb(${tr},${tg},${tb})`;
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded"
      style={{ backgroundColor: bg, color: text }}
    >
      <span>{Math.round(value)}</span>
      <span className="opacity-80">{category}</span>
    </span>
  );
}
