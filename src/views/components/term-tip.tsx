import { useEffect, useId, useState, type ReactNode } from "react";
import {
  workoutGlossary,
  type GlossaryTermId,
} from "@/workout-glossary.js";

/**
 * Tappable jargon chip. Opens a small popup with a plain-Korean explanation.
 */
export function TermTip({
  term,
  children,
  className = "",
}: {
  term: GlossaryTermId;
  /** Override visible label; defaults to glossary label. */
  children?: ReactNode;
  className?: string;
}) {
  const entry = workoutGlossary[term];
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!entry) return <>{children}</>;

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        className={`inline-flex items-center gap-0.5 rounded border border-dashed border-blue-600/50 bg-blue-600/5 px-1 py-0.5 text-inherit font-semibold text-blue-700 underline-offset-2 hover:bg-blue-600/10 dark:text-blue-300 ${className}`}
        aria-haspopup="dialog"
        title={`${entry.title} — 눌러서 설명 보기`}
      >
        {children ?? entry.label}
        <span className="text-[10px] font-bold opacity-70" aria-hidden>
          ?
        </span>
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-background p-4 text-foreground shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <h3 id={titleId} className="text-base font-bold">
                {entry.title}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs"
              >
                닫기
              </button>
            </div>
            <p className="mt-2 text-sm leading-relaxed">{entry.body}</p>
            {entry.example ? (
              <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                {entry.example}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Render a sentence with known jargon replaced by TermTips when exact tokens match. */
export function withTermTips(
  text: string,
  terms: Array<{ match: string; term: GlossaryTermId }>,
): ReactNode {
  const sorted = [...terms].sort((a, b) => b.match.length - a.match.length);
  type Piece = { type: "text"; value: string } | { type: "term"; term: GlossaryTermId; value: string };
  let pieces: Piece[] = [{ type: "text", value: text }];
  for (const { match, term } of sorted) {
    const next: Piece[] = [];
    for (const piece of pieces) {
      if (piece.type !== "text") {
        next.push(piece);
        continue;
      }
      const parts = piece.value.split(match);
      parts.forEach((part, index) => {
        if (part) next.push({ type: "text", value: part });
        if (index < parts.length - 1) {
          next.push({ type: "term", term, value: match });
        }
      });
    }
    pieces = next;
  }
  return (
    <>
      {pieces.map((piece, index) =>
        piece.type === "text" ? (
          <span key={`t-${index}`}>{piece.value}</span>
        ) : (
          <TermTip key={`j-${index}-${piece.term}`} term={piece.term}>
            {piece.value}
          </TermTip>
        ),
      )}
    </>
  );
}
