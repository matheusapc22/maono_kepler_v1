import type { MapFilterHistogramBin } from "../../../engine-adapter/types.ts";

type Props = {
  bins: MapFilterHistogramBin[];
  selectedRange: [number, number] | null;
};

export default function FilterHistogram({ bins, selectedRange }: Props) {
  if (!bins.length) return null;

  const maximum = Math.max(1, ...bins.map((bin) => bin.count));

  return (
    <div
      className="maono-filter-histogram"
      role="img"
      aria-label={`Distribuição em ${bins.length} intervalos`}
    >
      {bins.map((bin, index) => {
        const selected =
          !selectedRange ||
          (bin.end >= selectedRange[0] && bin.start <= selectedRange[1]);

        return (
          <span
            key={`${bin.start}-${bin.end}-${index}`}
            className={selected ? "is-selected" : ""}
            style={{
              height: `${Math.max(3, (bin.count / maximum) * 100)}%`,
            }}
            title={`${bin.count} registros`}
          />
        );
      })}
    </div>
  );
}
