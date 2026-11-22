# Hands-On Diet

한국형 피트니스·식단·인바디 MCP 앱. 대화와 카드로 식사·운동·손 치수·인바디를 기록하고, 고정 트레이너 톤(독해+유머)으로 피드백한다. 사용자별 말투 단계 설정은 없다.

## Home

- **Tool**: `open-home` — 사이드바(`global`)·대화 패널(`thread`) 진입점. 입력 `{ intent?, accountKey? }`. 대화가 시작되면 모델이 다른 도구보다 먼저 이 도구를 연다(Claude 포함).
- **View**: 프로필 상태(이름·손·인바디)와 기능 버튼. 버튼은 세 묶음이다.
  - 기록: 식사 기록, 바코드, 맞춤 운동, 운동 기록, 식단 기록 고치기
  - 차트: 오늘 요약, 식단 차트, 성실도 달력, 영양소 흐름, 운동 성장, 인바디 차트
  - 설정: 손 치수 (MVP에서는 이름 메뉴 숨김, 호칭은 `고객님`)
- **Energy bars (항상 표시)**: `open-home` / `get-user`의 `energyToday`(`resolveDailyEnergyPlan`). 인바디(+워너비·기한)가 있으면 Recharts 세로축 kcal · 가로 `1일 운동` / `탄수화물` / `단백질` / `지방` / `기초대사량`. 운동·탄·단·지는 **오늘(실제)**·**기준(목표)** 쌍 막대. 기초대사량은 BMR 단일 막대(비교 없음). 탄·단·지는 헤더·툴팁에 `kcal`와 `g`를 함께 표기(4-4-9). 탄·단·지 기준은 `carbKcal`/`carbG` 등, 운동 기준은 `targetExerciseKcal`. 헤더에 오늘 소비(`BMR+운동`)·섭취 합·탄단지 오늘/목표와 목표 총소비를 적는다. 막대 값은 오늘 `meal_logs`·`workout_logs` 합이라 식사·운동 저장 후 `bumpProfile`로 바로 바뀐다. 인바디 전이면 안내 문구만.
- **Buttons**: 차트·기록 카드는 홈 안에서 바로 연다. 식사 기록은 홈 패널에서 사진 0~1장으로 연다. 사진이 필요한 것(손 치수, 인바디 등록)만 대화로 넘긴다. 기록에 워너비 체형·맞춤 운동이 있다. 설정에 인바디 등록·손·이름·Google·카카오 로그인이 있다. 로그인된 홈에는 로그아웃이 있다. D1에 저장되는 이름·손·인바디·워너비·식사·로그인 후 `bumpProfile`으로 열린 홈이 `get-user`를 다시 불러 상태 점(인바디 측정일·체중, 워너비, 오늘 식사·`energyToday` 포함)이 바로 갱신된다.
- **Intent**: `open-home`의 `intent`가 오면 같은 버튼을 자동으로 누른다(`body-goal`, `workout-plan`, `login` 포함). Claude처럼 accountKey가 대화에 없을 때 쓴다.
- **Order**: Claude·새 기기는 **회원가입/로그인→손→인바디**. MVP(`src/mvp.ts`)에서는 개인 이름을 묻지 않고 `고객님`으로만 부른다. `nameSaved`는 true, `set-display-name`은 열지 않는다. 카드가 자기 키로 부른 `get-user`가 `loginRequired`면 홈이 로그인 카드를 먼저 연다. ChatGPT(`openai/subject`)는 로그인 생략.
- **Login**: `open-login` / `start-oauth`(mode `signup`|`login`) / `finish-oauth`. 식별키=`users.email`, 프로필 허브=`users`, OAuth 매핑=`oauth_identities`. 가입은 새 이메일만, 로그인은 기존 이메일만. OAuth 닉네임 → `users.display_name`. Workers `/auth/:provider/callback`. 로그인 전 `save-display-name` 거부. 홈 안 로그인은 `open-home`이 준 OAuth 준비값으로 패널만 그리고, `open-login` 뷰 도구는 호출하지 않는다(호스트 iframe이 비는 현상 방지). OAuth 성공 직후 단독 로그인 카드는 `open-home`을 열고, 홈 안 패널은 닫혀 홈 메뉴로 돌아간다. 위젯 `callTool`은 호스트 LLM이 못 보므로, 로그인 성공·인바디 등 사진 요청 시 `accountKey`/login 지시는 `useModelContext`(`audience: assistant`)로만 넘기고, `useSendFollowUpMessage`에는 사용자용 짧은 문장만 넣는다(호스트가 follow-up의 audience를 무시해 채팅에 키가 노출되는 경우 방지). `finish-oauth`는 로그인 전 `guest_` 키를 `account_aliases`로 OAuth 사용자에 묶어, 모델이 예전 키로 `get-user`를 불러도 `loginRequired=false`가 나오게 한다.
- **Identity (로그인 상태 단일 기준 · 동결)**: **2026-11-16 사용자 확인 — 로그인 후 반영 정상. 사용자가 로그인/신원 수정을 명시하지 않으면 이 블록과 관련 코드를 바꾸지 않는다** (`.cursorrules` §5.2). 로그인 판정은 `src/identity.ts`의 `identify()` 하나만 쓴다. 상태는 `ready`(호스트 subject 또는 Google/카카오에 묶인 키) · `login`(이 기기는 로그인 전) · `pending`(홈 카드가 아직 연결 안 함) · `unknown`(키 없음)이다. 저장·조회 도구(`accountId`)는 `ready`가 아니면 거부한다. 즉 홈이 "로그인 필요"일 때만 저장이 거부된다.
  - Claude에는 서버 쪽 사용자 식별이 없다. 로그인한 키는 위젯 `localStorage`에만 있고, 모델은 도구 결과에 적힌 것만 안다. 그래서 `open-home`·`open-login`은 로그인된 키 없이 불리면 `conversationKey`(`guest_` UUID)를 발급해 모델에게 "이 대화의 accountKey"로 알려 주고 `conversation_keys`에 pending으로 적는다.
  - 홈·로그인 카드는 열리자마자, 그리고 로그인 직후, `link-account-key({ conversationKey, accountKey: 기기 키 })`를 부른다. 기기가 로그인돼 있으면 `account_aliases`에 `conversationKey → users.id`를 넣는다. 이후 모델의 키와 카드의 키가 같은 `users` 행을 가리킨다.
  - `open-home`은 모델에게 "로그인 안 됨"을 말하지 않는다(`identityPending: true`, `loginRequired: false`). 모델은 받은 키로 `get-user`를 불러 `loginRequired`를 확인한다. 카드가 아직 연결 중이면 도구가 최대 8초 기다린다.
  - 카드는 `identityPending` 동안 "계정 확인 중"을 보이고, 자기 키로 부른 `get-user` 결과가 온 뒤에만 로그인 패널이나 intent를 연다.
  - 뷰 도구 출력의 `accountKey`는 로그인된 계정일 때만 채운다(위젯이 낯선 키로 저장된 키를 덮어쓰지 않게). 이미 OAuth 계정인 키는 다른 계정의 alias로 만들지 않는다.
  - 남은 한계: 홈에서 로그아웃해도 모델이 이미 받은 키는 계속 그 계정을 가리킨다.
- **Display**: entrypoint는 fullscreen. inline에서도 같은 메뉴를 보여 준다.
- **Guidance**: 온보딩 저장 후 다음 단계(손→인바디→식사)를 사용자에게 안내한다. 모든 답변 끝에 `홈화면` 검색 안내를 붙인다.

## Diet

- **`estimate-food-kcal`**: DB에 없는 음식의 100g당 kcal는 **호스트가 추정**해 넘긴다(구 `analyze-food-with-workers-ai` / Workers AI 제거). 서버는 1~900 클램프만 한다. `preview-meal-kcal`의 `baseKcal`에도 같은 값을 쓴다.
- **손 (`preview-hand-size` / `save-hand-size` / `get-hand-size`)**: 예시 사진은 `src/widgets/손사진.png` 한 장(카드로 재는 손바닥과 생쌀 1줌이 같이 있다). 카드(8.56×5.4cm) 대비 `handLengthCm`·`handWidthCm`과 생쌀 1줌 부피 `users.handful_volume_ml`. 쌀 g ÷ 0.85 g/ml, 또는 컵 지름·쌀 높이로 기하 부피. `handSaved`는 길이·폭·1줌이 모두 있을 때. 사진·줌·그릇 경로는 이 셋이 있어야 한다. 사진 없는 글만 기록은 예외다.
- **`write-meal-foods` → `lookup-meal-portions` → `record-meal-photos`**: 홈 **식사 기록**은 한 끼, 사진 0~1장. 홈 패널에 카드를 바로 연다(뷰 도구를 홈 안에서 호출하지 않음). 채팅으로 말하면 `write-meal-foods`를 연다. 상단에 한 끼·사진 최대 1장 고지. **양(g)은 DB 기준 분량·그릇·줌으로만** 내고, 웹에서 “보통 몇 g”를 찾지 않는다. **kcal·탄단지는 K-FCDB 우선**. DB **완전일치**가 없으면 포함·접두·동의어(`alsoSearch`, 호스트 판단·계란→달걀)로 후보를 모아 카드에 목록을 띄운다. 호스트는 사진과 비슷한 순으로 `candidatePicks`를 보강할 수 있다. 사용자가 목록에서 고르면 `matchedFoodName`+`nameConfirmed`로 DB 행을 쓰고, **목록에 없음**이면 호스트가 단위 1개 kcal·탄단지 g를 `kcalPerUnit`·`carbPerUnit`·`proteinPerUnit`·`fatPerUnit`에 넣는다(저장 후 홈·기간 차트에 반영). 줌은 저장된 손 1줌이라 단위를 바꾸지 않는다. 웹 검색은 하지 않는다. 꼭 해야 하면 `{음식명} {단위} 열량`만. DB 영양 추정 follow-up은 `note`·`accountKey`를 채팅에 넣고 호스트가 그대로 쓴다. 카드는 peek(pending TTL 30분). **저장**만 `record-meal-photos` → `meal_logs` + `bumpProfile`. 끼니 사진은 저장하지 않는다. 그 외 식사 버튼은 호스트 입력창에 쓰지 않고 `useAssistantContext`만 쓴다.
  - **글만** (`cuisine=text`, 사진 없음, 간식 제외): 손 UI를 쓰지 않는다. 손 1줌이 없어도 된다. `바나나 1개`처럼 적으면 DB 기준 분량(1개·1회 제공량) × 개수. 카드에서 개수/분량만 고친다.
  - **한식 사진**: 사진+음식명이 오면 호스트가 `vesselHints`로 밥·국 그릇을 판단한다. **개인 공기·국그릇 지름은 저장된 손 폭을 그대로 쓰지 않고**, 사진 속 손바닥과 그릇 비율로 `containerDiameterCm`·`thicknessCm`을 추정해 카드에 반영한다(오기 전에는 「지름 판별 중」). **냄비·후라이팬·전골냄비**면 `sharedPot`으로 줌 입력을 연다. 그 외 음식은 사용자가 단위를 직접 적는다. 줌이면 `g = 줌 × handfulVolumeMl × 밀도`.
  - **양식**: 손 길이 눈금의 그릇. `volumeKcal`와 DB(없으면 웹) 1인분 kcal 차이가 10% 미만이면 1인분 kcal, 아니면 부피 kcal. 1인분이 없으면 부피만.
  - **간식**: 끼니를 간식으로 고르면 포장지(성분표) 사진을 요청한다. 호스트가 100g당 또는 1단위 kcal·g를 읽는다. 먹은 양은 사용자가 단위를 직접 적는다. 줌이면 1줌 부피가 필요하고, 그 외 단위는 `servingGrams` 또는 DB 기준 분량이 있으면 1줌 없이도 된다. 포장지 없이 글만이면 안내를 유지하고 기준 분량 × 분량비로 계산한다.
- **체형 코칭** (`src/meal-coach.ts`): C·과체중 `reduce`(원플레이트), 저체중 `bulk`(한상차림·공기밥 추가·메인 리필), 그 외 `maintain`. 확정 중량은 `useAssistantContext`로만 동기화한다. `lookup-meal-photo`는 예전 한 장 부피 보정용으로 남아 있고, 식사 카드의 한식 분량은 `lookup-meal-portions`의 그릇·줌을 쓴다.
- **`get-daily-summary-chart`** (view `daily-summary`): 하루 요약. `RadialBarChart` 동심원 4개(활동 칼로리·탄수화물·단백질·지방 달성률 %). 링은 100%에서 멈추고 숫자는 실제 값을 보여 준다.
- **`show-diet-chart`** (view `diet-chart`): 홈 **탄단지 열량**이 이 차트를 연다. 기본 창은 최근 30일이다. 위 알약으로 전체 열량(탄·단·지 kcal 누적 + 운동 소모 꺾은선)과 영양소별 kcal를 바꾸고, 7·14·30일로 자른다. 가로 기준선은 전체일 때 `goalKcal`, 탄/단/지일 때 `goalCarbKcal`·`goalProteinKcal`·`goalFatKcal`이다. 툴팁은 `600 kcal (150g / 목표 180g, 83%)` 형식이다. 제지방이 있으면 BMR·유지 칼로리를 적는다. `series`로 끼니별 막대·양방향 적자 막대를 덧붙일 수 있다. 홈의 영양소 흐름 버튼은 없다.
- **`show-habit-calendar`** (view `habit-calendar`): 월별 달력(이전/다음). 칸에 일자 숫자. 목표 안 초록, 115%까지 주황, 그 위 빨강, 미기록 회색. 날짜 탭 시 그날 요약. 기본 90일, 최대 1년. **스티커**는 워너비 시작~종료에만(정오 이후): 소모 충분→참잘, 미기록·섭취 과다→노력, **주간 코스 휴식일(X)→무조건 참잘**. **성장 나무**(달력 아래, `bg-white`): 같은 기간 참잘을 6단계 균등 분배. 기한·시작일 없으면 스티커 없음·나무는 1단계.
- **`show-nutrient-flow`** (view `nutrient-flow`): `@nivo/sankey`. 왼쪽 끼니 또는 음식(상위 7개 + 기타), 오른쪽 탄수화물·단백질·지방. 굵기는 kcal(탄·단 4, 지 9).
- **`scan-food-barcode`** (view) + `lookup-barcode`: `html5-qrcode`로 카메라·바코드 사진·숫자 입력. 제품은 Open Food Facts에서 찾고, 열량이 없으면 식품영양성분 데이터베이스에서 이름으로 채운다. 먹은 양을 고친 뒤 `save-meal-foods`로 저장한다. 호스트가 카메라를 막으면 사진·숫자로 넘어간다.
- **`get-diet-period`** (view `diet-period`) + `update-meal-log` + `delete-meal-log`: 기록을 한 줄씩 고치거나 지운다.
- **Goals**: `save-goals`로 kcal·탄단지·활동 목표를 저장한다. 없으면 워너비 체형·기한(`resolveDailyEnergyPlan`: 적자의 ~55% 식사·~45% 운동, EA/Alpert/주간속도 클램프), 그다음 인바디(Katch-McArdle × 1.375), 그것도 없으면 2000kcal. 카드·홈 막대에 어느 쪽인지 적는다. **호스트는 1일 권장 kcal·탄단지·클램프를 말할 때** `search-training-docs` topic=`daily_kcal`(원본 R2 `docs/training/daily-kcal.docx`, D1 `training_docs`)를 먼저 읽고 문서 근거로 설명한다.

## Workout

- **Training reference docs (R2 + D1)**: `list-training-docs` / `search-training-docs` / `get-training-doc`. 문서 3종 — `daily-kcal`, `exercise-selection`, `inbody-1rm` (로컬 원본 `content/training-docs/`). 원본 R2 `docs/training/*`, 청크 D1 FTS. 운동 코스·칼로리 선정 시 호스트가 읽고 쓴다. 시드 `npm run seed:training-docs`. `src/widgets`에는 워너비 체형 PNG만 둔다.
- **`choose-body-goal` / `save-body-goal` / `clear-body-goal`** (view `choose-body-goal`): 체형 사진 10장(`src/widgets`)을 5열 2행으로 보여 준다. 저장 시 `users.target_body_type`·`target_days`와 함께 **시작일 `target_started_on`(기기 오늘)** · **종료일 `target_ended_on`(시작+기한-1)** 을 D1에 넣는다. 이미 저장돼 있으면 카드가 **현재 세팅된 체형·기간**을 보여 주고 `운동기록 취소`(`clear-body-goal`) / `워너비 체형 수정` 버튼을 둔다. 성실도 스티커·성장 나무는 이 시작~종료 구간에만 붙는다. 홈 intent `body-goal`.
- **`recommend-inbody-workout`** (view `inbody-workout`): 맞춤 운동 카드. **기기 로컬 날짜(`clientDate`/`clientTimeZone`, 홈 위젯이 전달)** 기준 월~일 주간 코스를 D1 `workout_week_plans`에 저장한다. 같은 주·같은 장소/기구·같은 인바디 fingerprint면 `weekPlan.source=cache`로 불러오기만 하고, 다음 주 월요일(또는 fingerprint/빈 슬롯 변경)에만 다시 짜서 저장(`source=fresh`). 호스트는 cache일 때 `search-training-docs`를 다시 부르지 않는다. 레이아웃: **목표 kcal·체형 → 추천 방법 → 장소 → 이번주 코스 → 인체도+5각 → 오늘의 종목**(운동방법 찾기 · 운동부위 보기 · 1RM/최대횟수 찾기). (`src/inbody-analyzer.ts`, `src/workout-week-plan.ts`, `src/workout-schedule.ts`). **source=fresh이거나 사용자가 근거를 물을 때만** 호스트가 `search-training-docs`(exercise_selection·inbody_1rm)를 읽는다. 카드에서 **헬스장 / 홈트레이닝**만 고른다. 홈트레이닝이면 **집에 있는 기구**(맨몸·덤벨·케틀벨·밴드·철봉·벤치/의자/스텝)를 체크하고, 그 기구로 할 수 있는 종목만 추천한다. 맨몸은 기본이다. **오늘 부위는 사용자가 고르지 않는다.** 요일 템플릿(Phase 1 무분할, Phase 2 상·하 2분할, Phase 3 밀기·당기기·하체)에 인바디 상·하체 균형을 얹는다. 하체가 상체보다 발달하면 그 주는 상체 중심, 반대면 하체 중심이다. 종목은 DB를 먼저 채우고, 비는 역할은 `missingSlots`로 호스트가 `add-catalog-exercises`에 넣는다. 장소·기구를 바꾸면 카드에 실린 카탈로그로 다시 짜며, 뷰 도구를 홈 안에서 다시 부르지 않는다. 취약 부위 Priority Principle 선배치. **에너지**: `resolveDailyEnergyPlan`의 `targetExerciseKcal`(워너비·기한·안전 클램프)를 목표로 근력 세트 MET 소모를 합산하고, 부족분은 유산소(8~45분)를 코스 끝에 기본 추가한다. 카드에 목표/근력/유산소 kcal를 보여 준다. 카드 해부도는 기본 **현재 내몸상태**(노랑=취약, 빨강=우선·워너비 타겟)이고, 오늘의 종목을 누르면 그 종목의 **운동 부위** 해부도·방사형 제목으로 바뀐다. Phase 1 비대칭 → 편측+`rest_timer`. Phase 2~3 기존 규칙. 종목마다 `method`·`why`. `TermTip`·`evidence`. `injuredParts`·ECW/VFL 게이트. 덤벨·케틀벨 등 중량 운동은 1RM이 없으면 RIR 무게 탐색. 푸시업·플랭크·밴드·철봉처럼 맨몸(무게 없음)은 **적정 횟수 찾기**(수행 횟수 + RIR → 다음 세트 목표 회)를 쓴다. 오늘의 종목 옆 **운동방법 찾기**는 `lookup-exercise-howto`로 유튜브 `{종목} 하는법` 검색 결과(영상 제목·watch URL)를 그 항목 아래에 보여 주고, `useOpenExternal`로 연다.
- **구조 문제(`structuralIssues`)**: 상체·하체 좌우 근육량 차이가 5% 또는 0.25kg 이상이면 체중·체지방(BMI)과 무관한 구조 문제로 본다. 부위마다 편측 복합 종목 2개를 `required: true`로 코스 맨 앞에 넣고(목표 종목은 최소 2개 유지), 왜 꼭 해야 하는지 카드의 빨간 안내 박스·`필수 교정` 배지·도구 응답 문장으로 설명한다.
- **설득**: 모드·강도를 처음 바꾸면 목표 체형·인바디로 설득 → 재확인 시에만 변경. 부상·통증이면 설득 없이 대체. `[운동 시작]`은 fullscreen. 완료 시 `save-workout-log`.
- **`save-workout-log`**: 모드·시간(초)·라운드/세트·종목을 `workout_logs`에 저장(`mode`, `rounds` 포함).
- **`log-workout`** (view) + `lookup-workout-burn` + `save-workout-logs`: 근력/유산소 버튼 없음. 문장 입력(placeholder `달리기 60분동안 3km를 뛰었어`) → **검색** → 서버가 `parseWorkoutNote`로 종목·시간·거리·세트를 읽고 MET·체중으로 `burnedKcal`를 바로 계산 → 카드 표시 → **운동 저장**. 채팅 입력창에 follow-up 글을 넣지 않는다.
- **`show-workout-chart`** (view `workout-chart`): 종목별 주간 볼륨(`kg × 횟수 × 세트`) 그라데이션 `AreaChart`, 추정 1RM `ScatterChart`(Epley, 1~12회). 유산소는 주간 소모 kcal. 최근 기록은 `delete-workout-log`로 한 줄씩 지운다.
- **Burn**: MET(근력 5, 유산소 7) × 체중 × 시간. 시간이 없는 근력은 세트당 2.5분. 저장된 체중이 없으면 0으로 두고 그렇게 알린다.
- **DB**: `exercises` 종목 카탈로그. `users.target_body_type`. 홈 intent `workout-plan` / `body-goal`.

## InBody

- **View** `inbody-chart`: 추세 `ComposedChart` + `react-muscle-highlighter` 해부도(취약 노랑·타겟 빨강) + 5부위 `RadarChart` + C-I-D 가로 막대(체중·골격근량·체지방량의 표준 대비 %를 굵은 선으로 잇는다).
- **C-I-D**: 표준은 키·성별에서 어림한다(BMI 남 22 / 여 21.5, 체지방 15% / 23%, 골격근 표준 체중의 47% / 42%). 키·성별이 없으면 카드에서 받아 `save-body-profile`로 저장한다.
- **Required**: 인바디·매일 식사 필수. 인바디 신규 측정은 최소 28일 간격(같은 날 수정 OK).
- **Habits**: `get-user`가 setupComplete·mealMissedDays·mealMissLine을 돌려, 설정 미완료 시 등록 안내, 식사 누락 시 고정 `mealMissLine`으로 혼낸다.

## Guardrails

- **etag**: 조회 도구(`get-diet-period`, `show-workout-chart`)가 줄마다 etag를 준다. 수정·삭제 도구는 15분 안의 etag만 받고, 없거나 지났거나 그 사이 줄이 바뀌었으면 `precondition_failed`를 돌려준다. 서명은 사용자별 비밀값(`users.etag_secret`)으로 만든다.
- **삭제**: 한 번에 한 줄만 지운다. 여러 날을 지우는 도구는 없다.
- **출처**: `SourceFooter`는 **그 출처 정보를 카드에 실제로 보여줄 때만** 붙인다. K-FCDB는 식품·영양 수치가 있을 때, Open Food Facts는 바코드 제품이 있을 때. 성실도(출석)만 있으면 영양 출처를 넣지 않는다. 오픈소스도 그 카드가 쓰는 라이브러리만 — Recharts, `@nivo/sankey`, `react-muscle-highlighter`, `html5-qrcode`.
- **data-llm**: 사용자가 카드에서 바꾼 값(중량, 차트 종류, 고른 종목 등)은 `data-llm`으로 모델에 전한다.

## Affiliate

- **MVP**: 제휴 캐러셀은 끈다(`affiliateFor` → `show: false`). 부족분 계산·카드 UI 코드는 남겨 둔다.
- **나중**: 방금 계산한 부족분(단백질 부족, 하체 근육 부족)이 있을 때만 카드 아래에 캐러셀을 붙인다. Worker 변수 `COUPANG_PARTNERS_URL_CHICKEN`, `COUPANG_PARTNERS_URL_PROTEIN`, `IHERB_RCODE`, `LUNCHBOX_PARTNER_URL`이 있으면 제휴 링크로 열고 "제휴 링크 · 구매 시 수수료"라고 적는다.
