import type { McpServer } from "skybridge/server";
import { z } from "zod";
import { affiliateRedirectDomains } from "../affiliate.js";
import {
  buildAuthorizeUrl,
  createLoginAttempt,
  listLinkedProviders,
  oauthConfigured,
  oauthPublicBase,
  readLoginAttempt,
  signOAuthState,
  type OAuthEnv,
  type OAuthProvider
} from "../oauth.js";
import {
  addDays,
  daysBetween,
  getLastMealDate,
  getUserProfile,
  hasMealOnDate,
  INBODY_MIN_INTERVAL_DAYS,
  seoulToday
} from "../db/client.js";
import {
  findBodyGoal
} from "../body-goals.js";
import { MVP_CALL_NAME,
  MVP_SKIP_USER_NAME } from "../mvp.js";
import {
  claimConversationKey,
  identify,
  identityProblem
} from "../identity.js";

import {
  shown,
  modelOnly,
  homeWelcomeShown,
  withHomeTip,
  intentToolHint,
  issueConversationKey,
  accountKeyField,
  guestKey,
  mealMissCopy,
  homeIntentSchema,
  rememberAccountKey,
  homeIcon,
  emptyHomeProfile,
  todayEnergyFor,
  loadHomeProfile
} from "./helpers.js";

// Tool registration module (behavior preserved from server.ts).
export function registerIdentityHome<S extends McpServer>(server: S) {
  return server
      .registerTool(
        {
          name: "get-user",
          description:
            "이 사용자의 로그인·손 치수·최신 인바디와 식사·인바디 습관 상태를 한 번에 불러온다. MVP에서는 개인 이름을 쓰지 않고 displayName은 항상 ‘고객님’, nameSaved는 true다. set-display-name을 열지 않는다. accountKey가 없으면 먼저 open-home으로 키를 확보한 뒤 이 도구를 호출한다. Claude에서는 알려진 accountKey를 넘긴다. accountKey가 비어 needsBootstrap true이면 ‘계정이 없다’·‘로그인이 안 됐다’고 말하지 말고 바로 open-home을 열어 그 결과의 accountKey로 다시 호출한다. identityPending true이면 홈 카드가 계정을 연결하는 중이니 같은 accountKey로 다시 호출한다. loginRequired true이면 이름·손보다 먼저 Google/카카오 회원가입 또는 로그인을 안내하고 open-home intent login 또는 open-login을 연다. loginRequired false이고 setupComplete false면 기본 설정 등록을 안내한다. handSaved false면 preview-hand-size로 손 치수를 받는다. inbodySaved false면 save-inbody로 인바디를 받는다(필수). mealMissedDays가 1 이상이면 식사 누락을 짧게 혼내고 오늘 식사를 받게 한다.",
          inputSchema: accountKeyField(),
          annotations: {
            title: "Get user profile",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Loading the user profile…",
            "openai/toolInvocation/invoked": "User profile loaded.",
          },
        },
        async ({ accountKey }, extra) => {
          const identity = await identify(extra, accountKey, { wait: true });
          if (identity.state !== "ready") {
            // Only "login" means the device is not logged in. Without a key, or
            // before the home card has linked it, the answer is not known yet.
            const problem = identityProblem(identity);
            const loginRequired = identity.state === "login";
            return {
              content: [
                shown(withHomeTip(problem.shown)),
                modelOnly(problem.model),
              ],
              structuredContent: {
                ...emptyHomeProfile,
                needsBootstrap: identity.state === "unknown",
                identityPending: !loginRequired,
                loginRequired,
                loginSaved: false,
                accountKey:
                  identity.state === "unknown" ? "" : guestKey(identity.userId),
                muscleUpperLeftKg: 0,
                muscleUpperRightKg: 0,
                muscleCoreKg: 0,
                muscleLowerLeftKg: 0,
                muscleLowerRightKg: 0,
                setupComplete: false,
                missingBasics: loginRequired ? ["로그인"] : [],
              },
            };
          }
          const userId = identity.userId;
          const user = await getUserProfile(userId);
          const handSaved =
            user?.handLengthCm != null &&
            user.handWidthCm != null &&
            user.handfulVolumeMl != null &&
            user.handfulVolumeMl > 0;
          const inbodySaved =
            user?.weightKg != null &&
            user.skeletalMuscleKg != null &&
            user.bodyFatKg != null;
          // MVP: 실명 등록을 건너뛰고 고객님으로만 부른다.
          const rawDisplayName = user?.displayName?.trim() ?? "";
          const displayName = MVP_SKIP_USER_NAME
            ? MVP_CALL_NAME
            : rawDisplayName;
          const nameSaved = MVP_SKIP_USER_NAME
            ? true
            : rawDisplayName.length > 0;
          const today = seoulToday();
          const yesterday = addDays(today, -1);
          const lastMealDate = await getLastMealDate(userId);
          const mealLoggedToday = await hasMealOnDate(userId, today);
          const setupComplete =
            (MVP_SKIP_USER_NAME || nameSaved) && handSaved && inbodySaved;
          let mealMissedDays = 0;
          if (setupComplete) {
            if (!lastMealDate) {
              mealMissedDays = 1;
            } else if (lastMealDate < yesterday) {
              mealMissedDays = Math.max(1, daysBetween(lastMealDate, yesterday));
            }
          }
          const lastInbodyOn = inbodySaved ? (user?.inbodyMeasuredOn ?? "") : "";
          const daysSinceInbody =
            lastInbodyOn.length > 0 ? daysBetween(lastInbodyOn, today) : 0;
          const inbodyDue =
            setupComplete && daysSinceInbody >= INBODY_MIN_INTERVAL_DAYS;
          const bodyGoal = findBodyGoal(user?.targetBodyType);
          const energyToday = await todayEnergyFor(userId, user);
          const missingBasics = [
            MVP_SKIP_USER_NAME || nameSaved ? "" : "이름",
            handSaved ? "" : "손 치수",
            inbodySaved ? "" : "인바디",
          ].filter((item) => item.length > 0);
          const mealMissLine =
            mealMissedDays > 0 ? mealMissCopy() : "";
          const profile = {
            needsBootstrap: false,
            identityPending: false,
            loginRequired: false,
            loginSaved: true,
            accountKey: guestKey(userId),
            nameSaved,
            displayName,
            toneSaved: true,
            toneLevel: 0,
            toneTitle: "",
            handSaved,
            handLengthCm: user?.handLengthCm ?? 0,
            handWidthCm: user?.handWidthCm ?? 0,
            handfulVolumeMl: user?.handfulVolumeMl ?? 0,
            inbodySaved,
            measuredOn: lastInbodyOn,
            weightKg: user?.weightKg ?? 0,
            skeletalMuscleKg: user?.skeletalMuscleKg ?? 0,
            bodyFatKg: user?.bodyFatKg ?? 0,
            bodyFatPercent: user?.bodyFatPercent ?? 0,
            bodyGoalSaved: bodyGoal !== null,
            bodyGoalTitle: bodyGoal?.title ?? "",
            targetDays: user?.targetDays ?? 0,
            lastAuthProvider: user?.lastAuthProvider ?? "",
            email: user?.email ?? "",
            lastLoginAt: user?.lastLoginAt ?? "",
            muscleUpperLeftKg: user?.muscleUpperLeftKg ?? 0,
            muscleUpperRightKg: user?.muscleUpperRightKg ?? 0,
            muscleCoreKg: user?.muscleCoreKg ?? 0,
            muscleLowerLeftKg: user?.muscleLowerLeftKg ?? 0,
            muscleLowerRightKg: user?.muscleLowerRightKg ?? 0,
            setupComplete,
            missingBasics,
            today,
            lastMealDate: lastMealDate ?? "",
            mealLoggedToday,
            mealMissedDays,
            mealMissLine,
            inbodyDue,
            daysSinceInbody,
            inbodyMinIntervalDays: INBODY_MIN_INTERVAL_DAYS,
            energyToday,
          };
          const keyHint = rememberAccountKey(userId);
          if (missingBasics.length > 0) {
            return {
              content: [
                shown(
                  withHomeTip(
                    `기본 설정을 등록하세요. 아직 비어 있는 항목: ${missingBasics.join(", ")}. 지금 이어서 등록할게요.`,
                  ),
                ),
                modelOnly(
                  MVP_SKIP_USER_NAME
                    ? `사용자를 '${MVP_CALL_NAME}'으로만 부르세요. 이름을 묻거나 set-display-name을 열지 마세요. 비어 있는 순서대로 진행합니다. 손은 카드와 손 사진으로 preview-hand-size, 인바디는 결과지 사진으로 save-inbody(필수, 건너뛰지 않음). 각 단계가 끝나면 다음 단계를 한 줄로 안내하고 답변 끝에 홈화면 안내를 넣으세요.`
                    : "사용자에게 기본 설정 등록을 요청하세요. 비어 있는 순서대로 진행합니다. 이름은 set-display-name, 손은 카드와 손 사진으로 preview-hand-size, 인바디는 결과지 사진으로 save-inbody(필수, 건너뛰지 않음). 각 단계가 끝나면 다음 단계를 한 줄로 안내하고 답변 끝에 홈화면 안내를 넣으세요. 이름·손·인바디가 끝나기 전에는 식단 잔소리만 하지 말고 설정 등록을 우선하세요.",
                ),
                ...(keyHint ? [keyHint] : []),
              ],
              structuredContent: profile,
            };
          }
          const habitLines = [
            mealMissedDays > 0
              ? mealMissLine
              : mealLoggedToday
                ? "오늘 식사 기록이 있어요."
                : "오늘 식사 기록이 아직 없어요. 식사 사진을 올려 주세요.",
            inbodyDue
              ? `마지막 인바디가 ${daysSinceInbody}일 전이에요. 한 달 간격이면 새 결과지를 올려도 됩니다.`
              : `인바디는 최소 ${INBODY_MIN_INTERVAL_DAYS}일 간격으로 등록합니다. 마지막 ${lastInbodyOn}.`,
          ];
          return {
            content: [
              shown(
                withHomeTip(
                  `${profile.displayName}. 손 ${profile.handLengthCm}×${profile.handWidthCm}cm, ${profile.measuredOn} 인바디 체중 ${profile.weightKg}kg.\n${habitLines.join("\n")}`,
                ),
              ),
              modelOnly(
                mealMissedDays > 0
                  ? `mealMissedDays=${mealMissedDays}. 식사 누락을 짧게 혼내고, 오늘 식사 사진을 지금 받아 write-meal-foods로 이어가세요. accountKey가 있으면 함께 넘기세요.`
                  : mealLoggedToday
                    ? "기본 설정 완료. 오늘 식사도 있음. 사용자가 원하는 기능으로 진행하세요."
                    : "기본 설정 완료. 오늘 식사가 없음. 오늘 식사 등록을 재촉하고 사진을 받으세요.",
              ),
              ...(keyHint ? [keyHint] : []),
            ],
            structuredContent: profile,
          };
        },
      )
      .registerTool(
        {
          name: "open-home",
          title: "홈",
          description:
            "Hands-On Diet 경량 메뉴판(런처)을 연다. 새 대화의 첫 메시지에서는 다른 카드보다 먼저 intent 없이 이 도구를 열어 홈화면을 보여 준다. 그 밖에는 사이드바·대화 패널 진입점, 또는 사용자가 홈·메뉴·기능 목록·`뭐 할 수 있어?`를 물을 때 호출한다. Claude에서 accountKey가 없을 때(bootstrap)에도 호출해 conversationKey를 발급한다. accountKey(또는 ChatGPT openai/subject)가 이미 있으면 식단·운동·차트·바코드·워너비는 open-home을 거치지 말고 해당 View Tool을 직접 호출한다. intent는 키가 없을 때 bootstrap용으로만 쓴다. 키가 있으면 intent 대신 해당 도구를 직접 연다. 알려진 accountKey가 있으면 함께 넘긴다. 결과의 accountKey를 이후 모든 사용자 도구에 넘긴다. 이 도구만으로 로그인 여부를 말하지 않는다.",
          icons: [homeIcon],
          inputSchema: {
            ...accountKeyField(),
            intent: homeIntentSchema,
          },
          annotations: {
            title: "Home",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Opening Hands-On Diet…",
            "openai/toolInvocation/invoked": "Home ready.",
          },
          view: {
            component: "home",
            description: "Hands-On Diet home with feature buttons",
            csp: {
              resourceDomains: [
                "https://fonts.googleapis.com",
                "https://fonts.gstatic.com",
              ],
              redirectDomains: affiliateRedirectDomains,
            },
          },
          openai: {
            entrypoints: [{ type: "global" }, { type: "thread" }],
          },
        },
        async ({ accountKey, intent }, extra) => {
          const identity = await identify(extra, accountKey);
          const ready = identity.state === "ready";
          const userId = ready ? identity.userId : undefined;
          // The server cannot see the device's login here. It never tells the
          // model "not logged in" from this tool: it issues a key, and the home
          // card links that key to whatever login the device already has.
          const conversationKey = await issueConversationKey(
            identity,
            accountKey,
          );
          const profile = await loadHomeProfile(userId);
          const keyHint = userId ? rememberAccountKey(userId) : null;
          const env = (await import("cloudflare:workers")).env as OAuthEnv;
          const linked = userId ? await listLinkedProviders(userId) : [];
          const effectiveIntent = intent ?? "";
          const mappedTool =
            effectiveIntent && intentToolHint[effectiveIntent]
              ? intentToolHint[effectiveIntent]
              : "";
          const welcomeUser = shown(homeWelcomeShown);
          const intentHint = !ready
            ? modelOnly(
                `identityPending=true. 이 대화의 accountKey는 ${conversationKey}이다. 이후 모든 사용자 도구(get-user, save-inbody 등)에 accountKey로 이 값을 그대로 넘긴다. 사용자에게 보여 주거나 물어보지 않는다. 홈 위젯이 이 기기에 저장된 로그인을 이 키에 연결한다. 로그인 여부는 아직 모른다. "로그인이 안 됐다"·"새 기기"라고 말하지 마세요. 로그인·설정 상태가 필요하면 이 accountKey로 get-user를 호출하고 그 결과의 loginRequired만 따르세요. open-login을 따로 호출하지 마세요.${
                  effectiveIntent
                    ? ` intent=${effectiveIntent}. 키가 연결되면 ${mappedTool || "해당 View Tool"}을 직접 호출하세요. 홈 안에 하위 패널을 열라고 하지 마세요.`
                    : " intent 없는 첫 진입이다. 사용자에게 홈화면·메뉴 안내(카드·`홈화면`/`뭐 할 수 있어?`)를 한 번 말하세요."
                }`,
              )
            : effectiveIntent
              ? modelOnly(
                  `intent=${effectiveIntent}. 홈은 메뉴판만 연다. 지금 ${mappedTool || "해당 View Tool"}을 accountKey와 함께 직접 호출하세요. 홈 위젯 안에 차트·식사 패널을 중첩하지 마세요. 사용자에게 accountKey 없음을 말하지 마세요.`,
                )
              : modelOnly(
                  "경량 홈 메뉴판을 열었습니다. 사용자에게 홈화면·메뉴 안내를 한 번 말하세요. 이미 키가 있으면 이후 기능 요청은 open-home 없이 해당 View Tool을 직접 호출하세요. 식별 불가·계정 없음을 말하지 마세요.",
                );
          const content =
            !effectiveIntent
              ? [welcomeUser, intentHint, ...(keyHint ? [keyHint] : [])]
              : [intentHint, ...(keyHint ? [keyHint] : [])];
          return {
            content,
            structuredContent: {
              ...profile,
              // Not ready is "unknown", not "login required": the home card
              // decides from the device's own key and shows the login panel.
              loginRequired: false,
              loginSaved: ready,
              identityPending: !ready,
              intent: effectiveIntent,
              accountKey: guestKey(userId),
              conversationKey,
              // Login panel inside home — do not call open-login (view) from the widget.
              signedIn: ready,
              linked,
              googleReady: oauthConfigured(env, "google"),
              kakaoReady: oauthConfigured(env, "kakao"),
              cloudProfile: {
                displayName: profile.displayName,
                nameSaved: profile.nameSaved,
                lastAuthProvider: profile.lastAuthProvider,
                email: profile.email,
                lastLoginAt: profile.lastLoginAt,
              },
            },
          };
        },
      )
      .registerTool(
        {
          name: "open-login",
          description:
            "Google·카카오 회원가입/로그인 카드를 연다. 이메일이 D1 사용자 키다. Claude·새 기기에서 loginRequired true이면 이름보다 먼저 이 카드를 연다. 가입 시 OAuth 닉네임이 displayName이 된다. ChatGPT는 openai/subject가 있으면 필수는 아니다. accountKey가 없으면 open-home으로 키를 확보한 뒤 loginRequired면 open-home intent login 또는 open-login을 연다.",
          inputSchema: accountKeyField(),
          annotations: {
            title: "Open login",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Opening the login card…",
            "openai/toolInvocation/invoked": "Login card ready.",
          },
          view: {
            component: "login",
            description: "Sign in with Google or Kakao",
            csp: {
              redirectDomains: [
                "https://accounts.google.com",
                "https://kauth.kakao.com",
              ],
            },
          },
        },
        async ({ accountKey }, extra) => {
          const identity = await identify(extra, accountKey);
          const userId =
            identity.state === "ready" ? identity.userId : undefined;
          const conversationKey = await issueConversationKey(
            identity,
            accountKey,
          );
          const env = (await import("cloudflare:workers")).env as OAuthEnv;
          const linked = userId ? await listLinkedProviders(userId) : [];
          const user = userId ? await getUserProfile(userId) : null;
          const rawName = user?.displayName?.trim() ?? "";
          const displayName = MVP_SKIP_USER_NAME ? MVP_CALL_NAME : rawName;
          const nameSaved = MVP_SKIP_USER_NAME ? true : rawName.length > 0;
          return {
            content: [
              shown(
                withHomeTip(
                  linked.length > 0
                    ? `로그인 계정(${displayName})이 연결되어 있어요.`
                    : "Google 또는 카카오로 로그인하면 저장되고, 다른 기기에서도 같은 기록을 불러와요.",
                ),
              ),
              modelOnly(
                `로그인 카드를 열었습니다. 사용자가 버튼을 누르면 start-oauth → finish-oauth 폴링으로 끝납니다. 카드가 로그인 성공 후 스스로 open-home을 엽니다.${
                  conversationKey
                    ? ` 이 대화의 accountKey는 ${conversationKey}이다. 카드가 로그인된 계정에 이 키를 연결한다. 이후 모든 사용자 도구에 accountKey로 그대로 넘기고, 로그인 여부는 이 키로 부른 get-user의 loginRequired만 따르세요. 사용자에게 보여 주지 않는다.`
                    : " 알려진 accountKey를 이후 도구에 그대로 쓰세요."
                }`,
              ),
            ],
            structuredContent: {
              signedIn: linked.length > 0,
              conversationKey,
              linked,
              cloudProfile: {
                displayName,
                nameSaved,
                lastAuthProvider: user?.lastAuthProvider ?? "",
                email: user?.email ?? "",
                lastLoginAt: user?.lastLoginAt ?? "",
              },
              googleReady: oauthConfigured(env, "google"),
              kakaoReady: oauthConfigured(env, "kakao"),
              accountKey: guestKey(userId),
            },
          };
        },
      )
      .registerTool(
        {
          name: "link-account-key",
          description:
            "홈·로그인 카드가, open-home·open-login이 준 conversationKey를 이 기기에 저장된 로그인 계정에 연결할 때 호출한다. 카드만 호출한다. 호스트 LLM이 직접 호출하지 않는다.",
          inputSchema: {
            conversationKey: z
              .string()
              .describe("open-home·open-login 결과의 conversationKey"),
            ...accountKeyField(),
          },
          annotations: {
            title: "Link account key",
            readOnlyHint: false,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Checking the account…",
            "openai/toolInvocation/invoked": "Account checked.",
          },
        },
        async ({ conversationKey, accountKey }) => {
          const result = await claimConversationKey({
            conversationKey,
            deviceKey: accountKey,
          });
          return {
            content: [
              modelOnly(
                result.loginSaved
                  ? "이 대화의 accountKey를 로그인된 계정에 연결했습니다."
                  : "이 기기는 아직 로그인 전입니다.",
              ),
            ],
            structuredContent: result,
          };
        },
      )
      .registerTool(
        {
          name: "start-oauth",
          description:
            "로그인/회원가입 카드에서 Google 또는 카카오 인증 URL을 만든다. mode=signup|login. 카드만 호출한다. 호스트 LLM이 직접 호출하지 않는다.",
          inputSchema: {
            provider: z.enum(["google", "kakao"]),
            mode: z.enum(["signup", "login"]).default("login"),
            ...accountKeyField(),
          },
          annotations: {
            title: "Start OAuth",
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: true,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Starting sign-in…",
            "openai/toolInvocation/invoked": "Sign-in URL ready.",
          },
        },
        async ({ provider, mode }) => {
          const env = (await import("cloudflare:workers")).env as OAuthEnv;
          const typed = provider as OAuthProvider;
          const authMode = mode === "signup" ? "signup" : "login";
          if (!oauthConfigured(env, typed)) {
            return {
              content: `${provider} 로그인이 아직 설정되지 않았습니다.`,
              structuredContent: {
                ok: false,
                authorizeUrl: "",
                attemptId: "",
                message: `${provider} 클라이언트 키가 없습니다. 서버 시크릿을 등록한 뒤 다시 시도하세요.`,
              },
            };
          }
          const { attemptId } = await createLoginAttempt({
            provider: typed,
            mode: authMode,
          });
          const state = await signOAuthState(env.OAUTH_STATE_SECRET!, attemptId);
          const baseUrl = oauthPublicBase(env);
          const authorizeUrl = buildAuthorizeUrl({
            env,
            provider: typed,
            state,
            baseUrl,
          });
          return {
            content:
              authMode === "signup"
                ? "회원가입 창 URL을 만들었습니다."
                : "로그인 창 URL을 만들었습니다.",
            structuredContent: {
              ok: true,
              authorizeUrl,
              attemptId,
              mode: authMode,
              message: "",
            },
          };
        },
      )
      .registerTool(
        {
          name: "finish-oauth",
          description:
            "로그인 카드가 OAuth 콜백이 끝났는지 폴링할 때 호출한다. 호스트 LLM이 직접 호출하지 않는다.",
          inputSchema: {
            attemptId: z.string().uuid(),
            ...accountKeyField(),
          },
          annotations: {
            title: "Finish OAuth",
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            "openai/widgetAccessible": true,
            "openai/toolInvocation/invoking": "Checking sign-in…",
            "openai/toolInvocation/invoked": "Sign-in checked.",
          },
        },
        async ({ attemptId, accountKey: priorKey }) => {
          const attempt = await readLoginAttempt(attemptId);
          if (!attempt) {
            return {
              content: "로그인 시도를 찾지 못했습니다.",
              structuredContent: {
                status: "error" as const,
                accountKey: "",
                linked: [] as Awaited<ReturnType<typeof listLinkedProviders>>,
                message: "로그인 시도를 찾지 못했습니다. 다시 눌러 주세요.",
              },
            };
          }
          if (attempt.status === "pending") {
            return {
              content: "아직 로그인 중입니다.",
              structuredContent: {
                status: "pending" as const,
                accountKey: "",
                linked: [] as Awaited<ReturnType<typeof listLinkedProviders>>,
                message: "",
              },
            };
          }
          if (attempt.status === "error" || !attempt.userId) {
            return {
              content: attempt.errorMessage || "로그인에 실패했습니다.",
              structuredContent: {
                status: "error" as const,
                accountKey: "",
                linked: [] as Awaited<ReturnType<typeof listLinkedProviders>>,
                message: attempt.errorMessage || "로그인에 실패했습니다.",
              },
            };
          }
          const linked = await listLinkedProviders(attempt.userId);
          const { clientKeyForUserId, linkAccountAlias } = await import("../oauth.js");
          const key =
            attempt.clientAccountKey ||
            (await clientKeyForUserId(attempt.userId));
          // Keep the pre-login guest_ key resolving to this OAuth user so the
          // host LLM does not keep calling get-user with a "not logged in" guest.
          await linkAccountAlias(priorKey, attempt.userId);
          await linkAccountAlias(key, attempt.userId);
          const user = await getUserProfile(attempt.userId);
          const rawName = user?.displayName?.trim() ?? "";
          const displayName = MVP_SKIP_USER_NAME ? MVP_CALL_NAME : rawName;
          const nameSaved = MVP_SKIP_USER_NAME ? true : rawName.length > 0;
          const cloudProfile = {
            displayName,
            nameSaved,
            toneSaved: true,
            handSaved:
              user?.handLengthCm != null &&
              user.handWidthCm != null &&
              user.handfulVolumeMl != null &&
              user.handfulVolumeMl > 0,
            inbodySaved: user?.weightKg != null,
            lastAuthProvider: user?.lastAuthProvider ?? "",
            email: user?.email ?? "",
            lastLoginAt: user?.lastLoginAt ?? "",
          };
          const message = MVP_SKIP_USER_NAME
            ? `기록을 불러왔습니다. '${MVP_CALL_NAME}'으로 부르세요. 이름을 묻지 마세요. 이후 도구에 이 accountKey를 그대로 쓰세요.`
            : nameSaved
              ? `'${displayName}' 기록을 불러왔습니다. OAuth 닉네임을 Hands-On Diet 이름으로 씁니다. 이후 도구에 이 accountKey를 그대로 쓰세요.`
              : "계정을 저장했습니다. 홈에서 이름을 이어 등록하세요.";
          const remember = rememberAccountKey(key);
          return {
            content: [
              shown(
                MVP_SKIP_USER_NAME
                  ? `${MVP_CALL_NAME}, 기록을 불러왔어요.`
                  : nameSaved
                    ? `${displayName}으로 이어갈게요. 기록을 불러왔어요.`
                    : "계정을 저장했어요. 홈으로 이어갈게요.",
              ),
              modelOnly(
                MVP_SKIP_USER_NAME
                  ? `loginDone=true. loginRequired=false. accountKey=${key}. 사용자는 이미 로그인했다. '${MVP_CALL_NAME}'으로만 부르세요. set-display-name을 열지 마세요. "아직 로그인 전"·"로그인해 주세요"·"로그인 카드"를 말하지 마세요. 손·인바디로 이어가세요.`
                  : `loginDone=true. loginRequired=false. accountKey=${key}. 사용자는 이미 로그인했다. "아직 로그인 전"·"로그인해 주세요"·"로그인 카드"를 말하지 마세요. 인바디는 이 accountKey로 save-inbody를 바로 호출하세요. 예전 guest_ 키가 있어도 같은 계정이다.`,
              ),
              ...(remember ? [remember] : []),
            ],
            structuredContent: {
              status: "done" as const,
              accountKey: key,
              linked,
              cloudProfile,
              message,
            },
          };
        },
      )
}
