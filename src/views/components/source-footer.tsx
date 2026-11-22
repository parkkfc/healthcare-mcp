/**
 * Bottom attribution for data sources and open-source libraries.
 * Pass `data` only when this card actually displays that source's numbers
 * (예: K-FCDB 영양·식품명). 성실도·출석만 보여 주면 `data`를 넘기지 않는다.
 * `libs`도 이 카드가 그 라이브러리 UI를 그릴 때만 넣는다.
 */

export type DataSource = {
  ko: string;
  en: string;
};

const OSS = {
  recharts: { name: "Recharts", license: "MIT" },
  "nivo-calendar": { name: "@nivo/calendar", license: "MIT" },
  "nivo-sankey": { name: "@nivo/sankey", license: "MIT" },
  muscle: { name: "react-muscle-highlighter", license: "MIT" },
  "html5-qrcode": { name: "html5-qrcode", license: "Apache-2.0" },
} as const;

export type OssLib = keyof typeof OSS;

function formatData(source: DataSource) {
  if (source.en.includes(source.ko)) return source.en;
  return `${source.ko} (${source.en})`;
}

export function SourceFooter({
  data,
  libs = [],
  note,
  className = "mt-3",
}: {
  data?: DataSource | null;
  libs?: OssLib[];
  note?: string;
  className?: string;
}) {
  const lines: string[] = [];
  if (data?.ko) lines.push(`출처: ${formatData(data)}`);
  if (libs.length > 0) {
    lines.push(
      `오픈소스: ${libs
        .map((id) => `${OSS[id].name} (${OSS[id].license})`)
        .join(" · ")}`,
    );
  }
  if (note) lines.push(note);
  if (lines.length === 0) return null;
  return (
    <div className={`${className} space-y-0.5 text-xs text-muted-foreground`}>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
