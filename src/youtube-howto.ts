/**
 * Search YouTube for "{exercise} 하는법" and return watch links.
 * Parses the public results page (no API key). Falls back to a search URL.
 */

export type HowtoVideo = {
  videoId: string;
  title: string;
  url: string;
  channel: string;
};

export function howtoSearchQuery(exerciseName: string) {
  const name = exerciseName.trim();
  return name.endsWith("하는법") ? name : `${name} 하는법`;
}

export function youtubeSearchUrl(query: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=ko`;
}

export async function searchExerciseHowto(
  exerciseName: string,
  limit = 5,
): Promise<{ query: string; searchUrl: string; videos: HowtoVideo[] }> {
  const query = howtoSearchQuery(exerciseName);
  const searchUrl = youtubeSearchUrl(query);
  try {
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) {
      return { query, searchUrl, videos: [] };
    }
    const html = await response.text();
    const videos = parseYoutubeResults(html, limit);
    return { query, searchUrl, videos };
  } catch {
    return { query, searchUrl, videos: [] };
  }
}

function parseYoutubeResults(html: string, limit: number): HowtoVideo[] {
  const fromInitial = parseYtInitialData(html, limit);
  if (fromInitial.length > 0) return fromInitial;

  // Fallback: pair nearby videoId + title runs in the HTML blob.
  const videos: HowtoVideo[] = [];
  const seen = new Set<string>();
  const blocks = html.split('"videoRenderer"');
  for (const block of blocks) {
    if (videos.length >= limit) break;
    const idMatch = block.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    if (!idMatch) continue;
    const videoId = idMatch[1]!;
    if (seen.has(videoId)) continue;
    const titleMatch =
      block.match(/"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"\}\]/) ||
      block.match(/"text":"((?:\\.|[^"\\])*)"/);
    const channelMatch = block.match(
      /"ownerText":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"\}\]/,
    );
    const title = decodeJsonString(titleMatch?.[1] ?? "").trim();
    if (!title || title.length < 2) continue;
    seen.add(videoId);
    videos.push({
      videoId,
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      channel: decodeJsonString(channelMatch?.[1] ?? "").trim(),
    });
  }
  return videos;
}

function parseYtInitialData(html: string, limit: number): HowtoVideo[] {
  const match = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});/);
  if (!match?.[1]) return [];
  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return [];
  }
  const videos: HowtoVideo[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown) => {
    if (videos.length >= limit || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const renderer = record.videoRenderer as Record<string, unknown> | undefined;
    if (renderer && typeof renderer.videoId === "string") {
      const videoId = renderer.videoId;
      if (!seen.has(videoId) && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        const title = textFromRuns(renderer.title) || textFromAccessibility(renderer);
        const channel = textFromRuns(renderer.ownerText);
        if (title) {
          seen.add(videoId);
          videos.push({
            videoId,
            title,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            channel,
          });
        }
      }
    }
    for (const value of Object.values(record)) visit(value);
  };

  visit(data);
  return videos;
}

function textFromRuns(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const runs = (value as { runs?: Array<{ text?: string }> }).runs;
  if (!Array.isArray(runs)) return "";
  return runs
    .map((run) => run.text ?? "")
    .join("")
    .trim();
}

function textFromAccessibility(renderer: Record<string, unknown>): string {
  const label = (
    renderer.title as
      | { accessibility?: { accessibilityData?: { label?: string } } }
      | undefined
  )?.accessibility?.accessibilityData?.label;
  return typeof label === "string" ? label.trim() : "";
}

function decodeJsonString(value: string) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value
      .replace(/\\u0026/g, "&")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}
