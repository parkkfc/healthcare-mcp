/**
 * content/training-docs → R2 originals + D1 training_docs / chunks.
 *
 * Usage:
 *   node scripts/seed-training-docs.mjs              # write SQL seed file only
 *   node scripts/seed-training-docs.mjs --apply-local
 *   node scripts/seed-training-docs.mjs --apply-remote
 *   node scripts/seed-training-docs.mjs --upload-r2
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = path.join(root, "content", "training-docs");
const outSql = path.join(root, "scripts", "seed-training-docs.sql");
const bucket = "healthcare-mcp-images";

const docs = [
  {
    id: "daily-kcal",
    topic: "daily_kcal",
    title: "1일 권장 칼로리 과학적 근거",
    summary:
      "FFM 기반 BMR/TDEE, 워너비 체형 에너지 격차, EA·Alpert·주간 감량속도·클린벌크 4대 가드레일, 탄단지 배분.",
    md: "1일 권장 칼로리 과학적 근거.md",
    docx: "1일 권장 칼로리 과학적 근거.docx",
    r2Key: "docs/training/daily-kcal.docx",
  },
  {
    id: "workout-course",
    topic: "workout_course",
    title: "인바디 기반 맞춤형 운동 코스 통합 처방 가이드",
    summary:
      "운동 코스 Single Source of Truth. ECW·VFL·비대칭·코어 후배치·가용 일수 분할·rest_timer 기본·조건부 AMRAP/EMOM·1RM/RIR·부상 대체.",
    md: "인바디 기반 맞춤형 운동 코스 통합 처방 가이드.md",
    /** Markdown-only; R2 stores .md (no .docx required). */
    docx: null,
    r2Key: "docs/training/workout-course.md",
  },
];

function cleanText(raw) {
  return raw
    .replace(/\[span_\d+\]\(start_span\)/g, "")
    .replace(/\[span_\d+\]\(end_span\)/g, "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkText(text, maxLen = 900) {
  const paras = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks = [];
  let buf = "";
  let heading = "";

  const flush = () => {
    const body = buf.trim();
    if (!body) return;
    chunks.push({ heading, body });
    buf = "";
  };

  for (const para of paras) {
    const maybeHeading =
      para.length < 100 &&
      (/^\d+(\.\d+)*[.\s]/.test(para) ||
        /^#{1,3}\s/.test(para) ||
        /^(원칙|가드레일|템플릿|워너비|공식|근거|공식명|Phase|ECW|VFL)/.test(para));
    if (maybeHeading) heading = para.replace(/^#+\s*/, "").slice(0, 120);

    if (buf.length + para.length + 1 > maxLen && buf.length > 120) {
      flush();
    }
    // Hard-split oversized single paragraphs.
    if (para.length > maxLen) {
      flush();
      for (let i = 0; i < para.length; i += maxLen) {
        chunks.push({ heading, body: para.slice(i, i + maxLen) });
      }
      continue;
    }
    buf = buf ? `${buf}\n${para}` : para;
  }
  flush();
  return chunks;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildSql() {
  const now = new Date().toISOString();
  const lines = [
    "DELETE FROM training_doc_chunks_fts;",
    "DELETE FROM training_doc_chunks;",
    "DELETE FROM training_docs;",
  ];

  for (const doc of docs) {
    const mdPath = path.join(docsDir, doc.md);
    if (!fs.existsSync(mdPath)) {
      throw new Error(`Missing markdown: ${mdPath}`);
    }
    const text = cleanText(fs.readFileSync(mdPath, "utf8"));
    const chunks = chunkText(text);
    const sourceFile = doc.docx ?? doc.md;
    lines.push(
      `INSERT INTO training_docs (id, title, topic, summary, r2_key, source_file, updated_at) VALUES (${sqlString(doc.id)}, ${sqlString(doc.title)}, ${sqlString(doc.topic)}, ${sqlString(doc.summary)}, ${sqlString(doc.r2Key)}, ${sqlString(sourceFile)}, ${sqlString(now)});`,
    );
    chunks.forEach((chunk, i) => {
      lines.push(
        `INSERT INTO training_doc_chunks (doc_id, chunk_index, heading, body) VALUES (${sqlString(doc.id)}, ${i}, ${sqlString(chunk.heading)}, ${sqlString(chunk.body)});`,
      );
    });
    console.log(`${doc.id}: ${chunks.length} chunks (${text.length} chars)`);
  }

  lines.push(
    "INSERT INTO training_doc_chunks_fts(training_doc_chunks_fts) VALUES('rebuild');",
  );
  return lines.join("\n");
}

function wrangler(args) {
  const wranglerJs = path.join(
    root,
    "node_modules",
    "wrangler",
    "bin",
    "wrangler.js",
  );
  execFileSync(process.execPath, [wranglerJs, ...args], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
}

const args = new Set(process.argv.slice(2));
const sql = buildSql();
fs.writeFileSync(outSql, sql, "utf8");
console.log(`Wrote ${outSql}`);

if (args.has("--upload-r2")) {
  const tmp = path.join(root, "scripts", ".tmp-training-docs");
  fs.mkdirSync(tmp, { recursive: true });
  for (const doc of docs) {
    const mdSrc = path.join(docsDir, doc.md);
    const asciiMd = path.join(tmp, `${doc.id}.md`);
    fs.copyFileSync(mdSrc, asciiMd);
    const mdKey = doc.r2Key.endsWith(".md")
      ? doc.r2Key
      : doc.r2Key.replace(/\.docx$/i, ".md");
    console.log(`R2 put ${mdKey}`);
    wrangler([
      "r2",
      "object",
      "put",
      `${bucket}/${mdKey}`,
      "--remote",
      "--file",
      asciiMd,
      "--content-type",
      "text/markdown; charset=utf-8",
    ]);
    if (doc.docx) {
      const file = path.join(docsDir, doc.docx);
      if (!fs.existsSync(file)) throw new Error(`Missing docx: ${file}`);
      const asciiDocx = path.join(tmp, `${doc.id}.docx`);
      fs.copyFileSync(file, asciiDocx);
      console.log(`R2 put ${doc.r2Key}`);
      wrangler([
        "r2",
        "object",
        "put",
        `${bucket}/${doc.r2Key}`,
        "--remote",
        "--file",
        asciiDocx,
        "--content-type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ]);
    }
  }
}

if (args.has("--apply-local")) {
  wrangler([
    "d1",
    "execute",
    "healthcare-mcp",
    "--local",
    `--file=${outSql}`,
  ]);
}
if (args.has("--apply-remote")) {
  wrangler([
    "d1",
    "execute",
    "healthcare-mcp",
    "--remote",
    `--file=${outSql}`,
  ]);
}
