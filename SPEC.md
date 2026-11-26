# Hands-On Diet

한국형 피트니스·식단·인바디 MCP 앱. 대화와 카드로 식사·운동·손 치수·인바디를 기록하고, 고정 트레이너 톤(독해+유머)으로 피드백한다. 사용자별 말투 단계 설정은 없다.

## Architecture (Chat-First · Pure Tool · 최소 View)

- **Chat-First**: 홈은 경량 메뉴판. 차트·식사·운동은 채팅에서 단일 View Tool을 연다.
- **Pure Tool**: 분량·kcal·운동 처방은 서버 도구가 `structuredContent`로 한 번에 돌린다. 카드는 확인·보정·저장. D1 pending peek/폴링 없음(`pending_meal_portions` DROP).
- **서버 조립**: 얇은 `src/server.ts` + `src/tools/*` 도메인 모듈(`identity-home` · `profile` · `diet` · `workout` · `charts` · `training-docs`). AppType 누적을 위해 `register-all.ts`가 단일 체인으로 등록한다. 로그인/신원 로직은 동결(복사만).
- **뷰 보조**: `src/hooks/`(`use-assistant-context`, `profile-sync`). 동결 훅(`use-account-key`, `use-claim-conversation-key`)은 `src/views/` 경로 유지.

## Home (Chat-First 경량 메뉴판)

- **Tool**: `open-home` — 새 대화 첫 메시지에서는 다른 카드보다 먼저 intent 없이 열어 홈화면을 보여 준다. 그 밖에는 사이드바(`global`)·대화 패널(`thread`) 진입점, 사용자가 홈·메뉴·`뭐 할 수 있어?`를 물을 때, 또는 Claude에서 accountKey bootstrap이 필요할 때 연다. 입력 `{ intent?, accountKey? }`. **accountKey(또는 ChatGPT subject)가 있으면** 식단·운동·차트는 open-home을 거치지 않고 해당 View Tool을 직접 호출한다.
- **View**: 경량 런처. 상태 점(로그인·손·인바디) + `energyToday` 막대 + 치트시트(채팅 예시) + 빠른 실행 버튼. **로그인 패널만** 홈 안에 연다(동결). 차트·식사·운동·손 패널은 홈에 중첩하지 않는다.
- **첫 진입 안내**: intent 없는 `open-home`은 `shown`으로 홈화면·메뉴 안내를 주고, 카드 상단에도 `홈화면` / `뭐 할 수 있어?` 안내를 둔다.
- **Buttons**: 누르면 `sendFollowUpMessage`에 짧은 한국어만 넣고(예: `탄단지 차트 보여줘`), 도구 지시는 `useModelContext(audience: assistant)`. 호스트가 단일 View Tool을 연다.
- **Intent**: 키가 없을 때 bootstrap용. 키가 있으면 모델이 매핑된 View Tool을 직접 호출한다. 홈 위젯은 `loginRequired`/intent=login일 때만 로그인 패널을 연다.
- **Energy bars**: `open-home` / `get-user`의 `energyToday` 동일.
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
- **Guidance / Discovery**: 온보딩 다음 단계·저장 완료 `modelOnly`에 다음 기능 1~2개 제안. `홈화면` 안내는 첫 진입·온보딩 미완료·도움말·에러·loginRequired에만. View 카드 하단에 채팅 예시 1줄(`ChatNextHint`).

## Diet

- **`estimate-unit-nutrition`**: DB 미스·목록에 없음 시 **위젯이 호출**. Workers AI **텍스트만**으로 1단위 kcal·탄단지 초안 JSON. 비전 금지. 실패 시 카드 직접 입력 + `useModelContext`(assistant)만(입력창 follow-up 금지).
- **손 (`preview-hand-size` / `save-hand-size` / `get-hand-size`)**: 예시 사진은 `src/widgets/손사진.png` 한 장(카드로 재는 손바닥과 생쌀 1줌이 같이 있다). 카드(8.56×5.4cm) 대비 `handLengthCm`·`handWidthCm`과 생쌀 1줌 부피 `users.handful_volume_ml`. 쌀 g ÷ 0.85 g/ml, 또는 컵 지름·쌀 높이로 기하 부피. `handSaved`는 길이·폭·1줌이 모두 있을 때. 사진·줌·그릇 경로는 이 셋이 있어야 한다. 사진 없는 글만 기록은 예외다.
- **단방향 식사**: 홈 식사 버튼 → follow-up `식사 기록할게` + 호스트가 `show-meal-entry-guide`를 **별도 카드**로 연다(홈에 붙인 패널 아님). LLM 채팅에 예시를 풀어 쓰지 않는다. 사용자가 음식명·양을 보내면 `write-meal-foods`(밥·국 그릇 높이 카드). `note`에 원문, `items`에 호스트가 음식마다 `role`을 판별해 넣는다(밥 rice, 국·찌개 soup, 나물·무침 side; 서버는 이름 정규식으로 role을 추측하지 않는다). 섭취량은 사진으로 짐작하지 않고 적은 줌·개만 쓴다. 밥·국 kcal는 그릇 크기·내용물 높이를 확정한 뒤에만 나온다. 이어서 `get-hand-size`·밥·국 `vesselHints`·`lookup-meal-portions`(DB 미스는 `estimate-unit-nutrition`)로 kcal를 확정한다. 카드에서 그릇 높이·양은 마지막 조회 기준으로 kcal가 비례해 바뀌고, 하단 **저장** 후에만 그 끼니 kcal·탄단지 차트가 나온다. `pending_meal_portions` peek/폴링·식사 `sendFollowUpMessage` 없음.
- **식사 카드 3단계 (반찬 선확정 → 밥·국 그릇 → 같은 카드 총합)**: (1) 카드가 열리면 **반찬만** `lookup-meal-portions`로 먼저 조회해 g·kcal·탄단지를 확정한다(DB 적중 = 사용자가 적은 양 × DB, DB 미스 = `estimate-unit-nutrition` 또는 호스트 `kcalPerUnit`; 개·장은 1단위 g, 줌은 `handfulVolumeMl × 밀도`). 밀도는 호스트 `densityGPerMl` 필드 우선, 없으면 서버 `resolveFoodDensityGPerMl` 폴백(별도 MCP 도구 없음). (2) **밥·국만** 그릇 지름·높이·채움 UI와 **100g당 kcal**을 보여 준다. 사용자가 「열량 계산」을 누르면 서버가 `부피 × 밀도 → g × kcal/100g`로 산출한다(그릇을 바꾸면 밥·국 결과만 지우고 반찬은 유지). DB 미스 밥·국은 1공기 단위가 아니라 `kcalPer100g`·`carbPer100g`·`proteinPer100g`·`fatPer100g`로 채운다(AI 단위 `100g`). 열량 계산 버튼은 밥·국만 대상이며 반찬 양 빈칸은 막지 않는다. 밥·국 지름이 없으면(첫 호출 누락·직접 미입력) 계산하지 않고, write-meal-foods를 재호출해 카드를 추가하지 않는다. (3) 총 kcal·탄단지는 **별도 뷰 도구 없이 같은 `write-meal-foods` 카드**의 확정 패널에 나오고, 반찬·밥·국 결과는 입력한 이름(`query`) 기준으로 병합한다(index 정렬 금지). 반찬-only/밥·국-only 조회를 분리하는 이유는 `lookup-meal-portions`가 DB 미스가 하나라도 있으면 전체를 `needsWebConfirm`으로 돌려주기 때문이다. DB 100g당 조회는 `lookup-meal-portions`와 같은 정확 일치(`nameMatch: exact`)를 쓴다. 이후 **저장** `record-meal-photos`.
- **`write-meal-foods` → `lookup-meal-portions` → `record-meal-photos`**: **채팅 우선**. 손바닥+식단 사진+음식명 → `get-hand-size` → 확인 카드. 사진만 있으면 음식명을 한 번 되묻는다. 홈 런처 식사 버튼은 채팅 안내만. 위젯 file은 미리보기·수동용. **kcal·탄단지는 K-FCDB 우선**. DB 미스 시 후보 → 선택 또는 `estimate-unit-nutrition`. **저장** `record-meal-photos` + `bumpProfile`.
  - **글만** (`cuisine=text`, 사진 없음, 간식 제외): 손 UI를 쓰지 않는다. 손 1줌이 없어도 된다. `바나나 1개`처럼 적으면 DB 기준 분량(1개·1회 제공량) × 개수. 카드에서 개수/분량만 고친다.
  - **한식 사진**: 사진+밥·국이면 호스트가 `get-hand-size` 후 `손 폭 cm × 그릇픽셀÷손바닥픽셀`로 `containerDiameterCm`을 **구한 뒤** `write-meal-foods`를 **한 번만** 연다(첫 UI에 그 지름 표시). 지름 없이 호출하면 서버가 `bowl_diameter_required`로 거부해 카드가 열리지 않는다. 손 폭 복사 금지. `lookup vesselHints`만 넣으면 카드에 안 들어온다. 손·그릇이 안 보이면 추정값(밥~11.5·국~13.2)을 넣고 사용자가 카드에서 고친다. **냄비·후라이팬·전골냄비**면 `sharedPot`으로 줌. 그 외는 사용자 단위. 줌이면 `g = 줌 × handfulVolumeMl × 밀도` — 밀도는 호스트 `items.densityGPerMl` 우선, 없으면 `resolveFoodDensityGPerMl` 폴백(나물~0.5, 김치~0.95, 밥~1.1 등). 반찬에 물 1.0 금지.
  - **양식**: 손 길이 눈금의 그릇. `volumeKcal`와 DB(없으면 웹) 1인분 kcal 차이가 10% 미만이면 1인분 kcal, 아니면 부피 kcal. 1인분이 없으면 부피만.
  - **간식**: 끼니를 간식으로 고르면 포장지(성분표) 사진을 요청한다. 호스트가 100g당 또는 1단위 kcal·g를 읽는다. 먹은 양은 사용자가 단위를 직접 적는다. 줌이면 1줌 부피가 필요하고, 그 외 단위는 `servingGrams` 또는 DB 기준 분량이 있으면 1줌 없이도 된다. 포장지 없이 글만이면 안내를 유지하고 기준 분량 × 분량비로 계산한다.
- **체형 코칭** (`src/meal-coach.ts`): C·과체중 `reduce`(원플레이트), 저체중 `bulk`(한상차림·공기밥 추가·메인 리필), 그 외 `maintain`. 확정 중량은 `useAssistantContext`로만 동기화한다. 한식 분량은 `lookup-meal-portions`의 그릇·줌을 쓴다.
- **`get-daily-summary-chart`** (view `daily-summary`): 하루 요약. `RadialBarChart` 동심원 4개(활동 칼로리·탄수화물·단백질·지방 달성률 %). 링은 100%에서 멈추고 숫자는 실제 값을 보여 준다.
- **`show-diet-chart`** (view `diet-chart`): 홈 **탄단지 열량**이 이 차트를 연다. 기본 창은 최근 30일이다. 위 알약으로 전체 열량(탄·단·지 kcal 누적 + 운동 소모 꺾은선)과 영양소별 kcal를 바꾸고, 7·14·30일로 자른다. 가로 기준선은 전체일 때 `goalKcal`, 탄/단/지일 때 `goalCarbKcal`·`goalProteinKcal`·`goalFatKcal`이다. 툴팁은 `600 kcal (150g / 목표 180g, 83%)` 형식이다. 제지방이 있으면 BMR·유지 칼로리를 적는다. `series`로 끼니별 막대·양방향 적자 막대를 덧붙일 수 있다. 홈의 영양소 흐름 버튼은 없다.
- **`show-habit-calendar`** (view `habit-calendar`): 월별 달력(이전/다음). 칸에 일자 숫자. 목표 안 초록, 115%까지 주황, 그 위 빨강, 미기록 회색. 날짜 탭 시 그날 요약. 기본 90일, 최대 1년. **스티커**는 워너비 시작~종료에만(정오 이후): 소모 충분→참잘, 미기록·섭취 과다→노력, **주간 코스 휴식일(X)→무조건 참잘**. **성장 나무**(달력 아래, `bg-white`): 같은 기간 참잘을 6단계 균등 분배. 기한·시작일 없으면 스티커 없음·나무는 1단계.
- **`scan-food-barcode`** (view) + `lookup-barcode`: `html5-qrcode`로 카메라·바코드 사진·숫자 입력. 제품은 Open Food Facts에서 찾고, 열량이 없으면 식품영양성분 데이터베이스에서 이름으로 채운다. 먹은 양을 고친 뒤 `record-meal-photos`로 저장한다. 호스트가 카메라를 막으면 사진·숫자로 넘어간다.
- **`get-diet-period`** (view `diet-period`) + `update-meal-log` + `delete-meal-log`: 기록을 한 줄씩 고치거나 지운다.
- **Goals**: `save-inbody`·`save-body-goal` 직후 서버가 인바디(+워너비)로 `resolveDailyEnergyPlan`을 돌려 `users` 목표 kcal·탄단지·소모 kcal를 갱신한다. `save-goals`로 수동 저장도 가능. 조회 시 저장된 목표가 있으면 그걸 쓰고, 없으면 워너비·기한 → 인바디(Katch-McArdle × 1.375) → 2000kcal 순. 카드·홈 막대에 source를 적는다. **호스트는 1일 권장 kcal·탄단지·클램프를 말할 때** `search-training-docs` topic=`daily_kcal`를 먼저 읽고 문서 근거로 설명한다.

## Workout

- **Training reference docs (R2 + D1)**: `list-training-docs` / `search-training-docs` / `get-training-doc`. 문서 2종 — `daily-kcal`(식단 kcal), `workout-course`(인바디 기반 맞춤형 운동 코스 통합 처방 가이드, Single Source of Truth). 구 `exercise-selection`·`inbody-1rm`은 제거. 로컬 원본 `content/training-docs/`, R2 `docs/training/*`, 청크 D1 FTS. 시드 `npm run seed:training-docs`. `src/widgets`에는 워너비 체형 PNG만 둔다.
- **`choose-body-goal` / `save-body-goal` / `clear-body-goal`** (view `choose-body-goal`): 체형 사진 10장(`src/widgets`)을 5열 2행으로 보여 준다. 저장 시 `users.target_body_type`·`target_days`와 함께 **시작일 `target_started_on`(기기 오늘)** · **종료일 `target_ended_on`(시작+기한-1)** 을 D1에 넣는다. 이미 저장돼 있으면 카드가 **현재 세팅된 체형·기간**을 보여 주고 `운동기록 취소`(`clear-body-goal`) / `워너비 체형 수정` 버튼을 둔다. 성실도 스티커·성장 나무는 이 시작~종료 구간에만 붙는다. 홈 intent `body-goal`.
- **`recommend-inbody-workout`** (view `inbody-workout`): 맞춤 운동 카드. **기기 로컬 날짜(`clientDate`/`clientTimeZone`, 홈 위젯이 전달)** 기준 월~일 주간 코스를 D1 `workout_week_plans`에 저장한다. 같은 주·같은 장소/기구·같은 인바디 fingerprint면 `weekPlan.source=cache`로 불러오기만 하고, 다음 주 월요일(또는 fingerprint 변경)에만 다시 짜서 저장(`source=fresh`). **빈 슬롯이 있으면 저장·뷰를 하지 않고** `isError` + `reason=workout_catalog_gaps`만 돌린다. 호스트는 `search-training-docs`(topic=`workout_course`) → `add-catalog-exercises`로 역할을 채운 뒤 **같은 장소·기구·날짜로 recommend를 한 번만** 다시 호출해 완성 카드를 연다(미완성 카드 재오픈 금지). 호스트는 cache일 때 `search-training-docs`를 다시 부르지 않는다. 카드에서 **이번주 코스 요일·O/X**는 초안(draft)으로 오각·종목에 즉시 반영되고, **「저장하기」→ `save-workout-week-plan`** 으로만 `workout_week_plans`에 영구 저장한다(저장 전 DB 미반영). O→X는 그날 코스를 대기 리스트(`{부위}/{원래날짜}`)에 넣고, X→O는 리스트 맨 위를 그 날에 입힌다(신규 analyze 없음). 요일을 바꾸면 하단 종목·오각도 그 날짜 `draftDay`를 따른다. 레이아웃: **목표 kcal·체형 → 추천 방법 → 장소 → 이번주 코스 → 인체도+5각 → 오늘의 종목**(운동방법 찾기 · 운동부위 보기 · 1RM/최대횟수 찾기). (`src/inbody-analyzer.ts`, `src/workout-week-plan.ts`, `src/workout-schedule.ts`). **source=fresh이거나 사용자가 근거를 물을 때만** 호스트가 `search-training-docs`(workout_course)를 읽는다. 카드에서 **헬스장 / 홈트레이닝**만 고른다. 홈트레이닝이면 **집에 있는 기구**(맨몸·덤벨·케틀벨·밴드·철봉·벤치/의자/스텝)를 체크하고, 그 기구로 할 수 있는 종목만 추천한다. 맨몸은 기본이다. **오늘 부위는 사용자가 고르지 않는다.** 요일 템플릿(Phase 1 무분할, Phase 2 상·하 2분할, Phase 3 밀기·당기기·하체)에 인바디 상·하체 균형을 얹는다. 하체가 상체보다 발달하면 그 주는 상체 중심, 반대면 하체 중심이다. 종목은 DB를 먼저 채우고, 비는 역할은 카드 열기 전에 `add-catalog-exercises`로 채운다. 장소·기구를 바꾸면 카드에 실린 카탈로그로 다시 짜며, 뷰 도구를 홈 안에서 다시 부르지 않는다. 취약 부위 Priority Principle 선배치(비중·선배치만, UPPER/LOWER 4일 연속 편중 템플릿 없음). **엔진(`workout-course`)**: C·VFL≥10·I자·비대칭 → `rest_timer` 기본; ECW ≤0.390 정상 / 0.390–0.400 디로딩 / >0.400 stopwatch+진료; Phase1 세션 4–6종·12–18세트 상한·코어 마지막; D자 `compositionGap`은 부호/방향성. **에너지**: `resolveDailyEnergyPlan`의 `targetExerciseKcal`을 목표로 근력 MET 합산 후 부족분은 유산소(8~45분). 해부도: 기본 내몸상태, 종목 탭 시 운동 부위. 종목마다 `method`·`why`. `TermTip`·`evidence`. `injuredParts`. 중량은 1RM 없으면 RIR 탐색, 맨몸은 적정 횟수 찾기. **운동방법 찾기** → `lookup-exercise-howto` + `useOpenExternal`.
- **구조 문제(`structuralIssues`)**: 상체·하체 좌우 근육량 차이가 5% 또는 0.25kg 이상이면 체중·체지방(BMI)과 무관한 구조 문제로 본다. 부위마다 편측 복합 종목 2개를 `required: true`로 코스 맨 앞에 넣고(목표 종목은 최소 2개 유지), 왜 꼭 해야 하는지 카드의 빨간 안내 박스·`필수 교정` 배지·도구 응답 문장으로 설명한다.
- **설득**: 모드·강도를 처음 바꾸면 목표 체형·인바디로 설득 → 재확인 시에만 변경. 부상·통증이면 설득 없이 대체. `[운동 시작]`은 fullscreen. 완료 시 `save-workout-log`.
- **`save-workout-log`**: 모드·시간(초)·라운드/세트·종목을 `workout_logs`에 저장(`mode`, `rounds` 포함).
- **`save-workout-week-plan`**: 카드에서 고친 이번 주 코스(O/X·종목)를 `workout_week_plans`에 저장. 뷰 없음. O인데 exercises 비면 거절.
- **`log-workout`** (view) + `lookup-workout-burn` + `save-workout-logs`: 근력/유산소 버튼 없음. 문장 입력(placeholder `달리기 60분동안 3km를 뛰었어`) → **검색** → 서버가 `parseWorkoutNote`로 종목·시간·거리·세트를 읽고 MET·체중으로 `burnedKcal`를 바로 계산 → 카드 표시 → **운동 저장**. 채팅 입력창에 follow-up 글을 넣지 않는다.
- **`show-workout-chart`** (view `workout-chart`): 종목별 주간 볼륨(`kg × 횟수 × 세트`) 그라데이션 `AreaChart`, 추정 1RM `ScatterChart`(Epley, 1~12회). 유산소는 주간 소모 kcal. 최근 기록은 `delete-workout-log`로 한 줄씩 지운다.
- **Burn**: MET(근력 5, 유산소 7) × 체중 × 시간. 시간이 없는 근력은 세트당 2.5분. 저장된 체중이 없으면 0으로 두고 그렇게 알린다.
- **DB**: `exercises` 종목 카탈로그. `users.target_body_type`. 홈 intent `workout-plan` / `body-goal`.

## InBody

- **`save-inbody`**: Pure Execution Tool(뷰 없음). 호스트가 결과지에서 **체중·골격근·체지방(kg/%)·5부위 근육·신장·성별·ECW/TBW(`ecwRatio`)·내장지방레벨(`visceralFatLevel`)**을 읽어 저장한다. 값을 지어내지 않는다. 저장 직후 서버가 이 인바디(+워너비 체형·기한)로 `resolveDailyEnergyPlan` → `users` 목표 kcal·탄단지·소모 kcal를 다시 쓴다. 홈 갱신은 `get-user`/`open-home` 재조회.
- **`recommend-inbody-workout`**: 저장된 인바디(ECW·VFL 포함)로 Phase·안전 게이트·주간 코스를 짠다. ECW/VFL을 도구 인자로 다시 받지 않는다. 없으면 `save-inbody` 재요청.
- **`save-body-goal`**: 워너비 저장 후에도 인바디 기준으로 목표 kcal를 다시 맞춘다.
- **View** `inbody-chart`: 추세 `ComposedChart` + `react-muscle-highlighter` 해부도(취약 노랑·타겟 빨강) + 5부위 `RadarChart` + C-I-D 가로 막대(체중·골격근량·체지방량의 표준 대비 %를 굵은 선으로 잇는다).
- **C-I-D**: 표준은 키·성별에서 어림한다(BMI 남 22 / 여 21.5, 체지방 15% / 23%, 골격근 표준 체중의 47% / 42%). `save-inbody`가 키·성별을 필수로 받는다(누락 시 `save-body-profile` 폴백).
- **Required**: 인바디·매일 식사 필수. 인바디 신규 측정은 최소 28일 간격(같은 날 수정 OK).
- **Habits**: `get-user`가 setupComplete·mealMissedDays·mealMissLine을 돌려, 설정 미완료 시 등록 안내, 식사 누락 시 고정 `mealMissLine`으로 혼낸다.

## Guardrails

- **etag**: 조회 도구(`get-diet-period`, `show-workout-chart`)가 줄마다 etag를 준다. 수정·삭제 도구는 15분 안의 etag만 받고, 없거나 지났거나 그 사이 줄이 바뀌었으면 `precondition_failed`를 돌려준다. 서명은 사용자별 비밀값(`users.etag_secret`)으로 만든다.
- **삭제**: 한 번에 한 줄만 지운다. 여러 날을 지우는 도구는 없다.
- **출처**: `SourceFooter`는 **그 출처 정보를 카드에 실제로 보여줄 때만** 붙인다. K-FCDB는 식품·영양 수치가 있을 때, Open Food Facts는 바코드 제품이 있을 때. 성실도(출석)만 있으면 영양 출처를 넣지 않는다. 오픈소스도 그 카드가 쓰는 라이브러리만 — Recharts, `react-muscle-highlighter`, `html5-qrcode`.
- **data-llm**: 사용자가 카드에서 바꾼 값(중량, 차트 종류, 고른 종목 등)은 `data-llm`으로 모델에 전한다.

## Affiliate

- **MVP**: 제휴 캐러셀은 끈다(`affiliateFor` → `show: false`). 부족분 계산·카드 UI 코드는 남겨 둔다.
- **나중**: 방금 계산한 부족분(단백질 부족, 하체 근육 부족)이 있을 때만 카드 아래에 캐러셀을 붙인다. Worker 변수 `COUPANG_PARTNERS_URL_CHICKEN`, `COUPANG_PARTNERS_URL_PROTEIN`, `IHERB_RCODE`, `LUNCHBOX_PARTNER_URL`이 있으면 제휴 링크로 열고 "제휴 링크 · 구매 시 수수료"라고 적는다.
