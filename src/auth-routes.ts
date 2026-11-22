import type { Skybridge } from "skybridge/server";
import {
  completeOAuthCallback,
  isOAuthProvider,
  oauthDoneHtml,
  oauthPublicBase,
  type OAuthEnv,
} from "./oauth.js";

async function workerEnv(): Promise<OAuthEnv> {
  const { env } = await import("cloudflare:workers");
  return env as OAuthEnv;
}

type AuthReq = {
  params: { provider?: string };
  query: Record<string, unknown>;
  protocol: string;
  get: (name: string) => string | undefined;
};

type AuthRes = {
  status: (code: number) => AuthRes;
  type: (value: string) => AuthRes;
  send: (body: string) => void;
};

/** Google / Kakao callback pages. Must be registered before app.run(). */
export function mountAuthRoutes(app: Skybridge) {
  app.express.get("/auth/:provider/callback", async (req: AuthReq, res: AuthRes) => {
    const provider = String(req.params.provider ?? "");
    if (!isOAuthProvider(provider)) {
      res.status(404).type("html").send(oauthDoneHtml(false, "알 수 없는 로그인입니다."));
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const error =
      typeof req.query.error === "string" ? req.query.error : "";
    if (error) {
      res
        .status(400)
        .type("html")
        .send(
          oauthDoneHtml(
            false,
            "로그인을 취소했거나 제공자가 거부했습니다. 채팅으로 돌아가 다시 눌러 주세요.",
          ),
        );
      return;
    }
    if (!code || !state) {
      res
        .status(400)
        .type("html")
        .send(oauthDoneHtml(false, "로그인 코드가 없습니다. 다시 시도해 주세요."));
      return;
    }

    try {
      const env = await workerEnv();
      const baseUrl = oauthPublicBase(env, `${req.protocol}://${req.get("host")}`);
      const result = await completeOAuthCallback({
        env,
        provider,
        code,
        state,
        baseUrl,
      });
      if (!result.ok) {
        res.status(400).type("html").send(oauthDoneHtml(false, result.message));
        return;
      }
      res
        .status(200)
        .type("html")
        .send(
          oauthDoneHtml(
            true,
            "계정 연결이 끝났습니다. 이 창을 닫고 채팅의 로그인 카드로 돌아가 주세요. 카드가 몇 초 안에 자동으로 이어집니다.",
          ),
        );
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "로그인 처리 중 오류가 났습니다.";
      res.status(500).type("html").send(oauthDoneHtml(false, message));
    }
  });
}
