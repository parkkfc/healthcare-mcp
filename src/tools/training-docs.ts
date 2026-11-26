import { text } from "skybridge/server";
import type { McpServer } from "skybridge/server";
import { z } from "zod";
import {
  getTrainingDocChunks,
  listTrainingDocs,
  searchTrainingDocs,
  trainingDocTopics
} from "../training-docs.js";


// Tool registration module (behavior preserved from server.ts).
export function registerTrainingDocs<S extends McpServer>(server: S) {
  return server
      .registerTool(
        {
          name: "list-training-docs",
          description:
            "D1에 저장된 Hands-On Diet 참고 문서 목록을 본다. daily-kcal(식단)과 workout-course(운동 코스 통합 가이드) 두 종이다. 본문은 search-training-docs 또는 get-training-doc으로 읽는다.",
          inputSchema: {},
          annotations: {
            title: "List training reference docs",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/toolInvocation/invoking": "Listing training docs…",
            "openai/toolInvocation/invoked": "Training docs listed.",
          },
        },
        async () => {
          const docs = await listTrainingDocs();
          return {
            content: [
              text(
                docs.length === 0
                  ? "참고 문서가 아직 없습니다. 시드가 적용됐는지 확인하세요."
                  : docs
                      .map(
                        (d) =>
                          `- ${d.id} [${d.topic}] ${d.title}: ${d.summary}`,
                      )
                      .join("\n"),
              ),
            ],
            structuredContent: { docs },
          };
        },
      )
      .registerTool(
        {
          name: "search-training-docs",
          description:
            "R2/D1에 둔 과학 근거 플레이북을 검색한다. 1일 권장 칼로리·탄단지·급격한 다이어트 차단을 말할 때 topic=daily_kcal. 운동 코스·분할·Phase·타이머·1RM/RIR·부상 대체·ECW/VFL은 topic=workout_course(단일 통합 문서). 칼로리 설명 전, 또는 recommend-inbody-workout이 source=fresh이거나 사용자가 근거·왜?를 물을 때만 호출한다. weekPlan.source=cache면 다시 부르지 않는다. 반환된 excerpt만 근거로 쓴다.",
          inputSchema: {
            query: z
              .string()
              .min(2)
              .describe("검색어. 예: EA 30, Alpert, 분수 볼륨, Mayhew, rest_timer."),
            topic: z
              .enum(trainingDocTopics)
              .optional()
              .describe(
                "daily_kcal | workout_course. 생략하면 전체.",
              ),
            limit: z
              .number()
              .int()
              .min(1)
              .max(12)
              .optional()
              .describe("최대 청크 수. 기본 6."),
          },
          annotations: {
            title: "Search training reference docs",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/toolInvocation/invoking": "Searching training docs…",
            "openai/toolInvocation/invoked": "Training docs searched.",
          },
        },
        async ({ query, topic, limit }) => {
          const hits = await searchTrainingDocs({ query, topic, limit });
          return {
            content: [
              text(
                hits.length === 0
                  ? "맞는 청크가 없습니다. query를 짧게 바꾸거나 topic을 빼 보세요."
                  : hits
                      .map(
                        (h, i) =>
                          `[${i + 1}] ${h.title} · ${h.heading || `(chunk ${h.chunkIndex})`}\n${h.excerpt}`,
                      )
                      .join("\n\n---\n\n"),
              ),
            ],
            structuredContent: { query, topic: topic ?? null, hits },
          };
        },
      )
      .registerTool(
        {
          name: "get-training-doc",
          description:
            "참고 문서 하나(daily-kcal | workout-course)의 앞쪽 청크를 순서대로 읽는다. search-training-docs로 범위를 좁힌 뒤 더 필요할 때만 쓴다.",
          inputSchema: {
            docId: z
              .enum(["daily-kcal", "workout-course"])
              .describe("문서 id."),
            limit: z
              .number()
              .int()
              .min(1)
              .max(40)
              .optional()
              .describe("앞에서부터 읽을 청크 수. 기본 12."),
          },
          annotations: {
            title: "Get training reference doc",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/toolInvocation/invoking": "Loading training doc…",
            "openai/toolInvocation/invoked": "Training doc loaded.",
          },
        },
        async ({ docId, limit }) => {
          const result = await getTrainingDocChunks(docId, limit ?? 12);
          if (!result) {
            return {
              content: [text(`문서 ${docId}가 없습니다.`)],
              structuredContent: { found: false, docId },
            };
          }
          return {
            content: [
              text(
                `${result.doc.title}\n${result.doc.summary}\nR2: ${result.doc.r2Key}\n\n` +
                  result.chunks
                    .map(
                      (c) =>
                        `## ${c.heading || `chunk ${c.chunkIndex}`}\n${c.body}`,
                    )
                    .join("\n\n"),
              ),
            ],
            structuredContent: {
              found: true,
              doc: result.doc,
              chunks: result.chunks,
            },
          };
        },
      )
}
