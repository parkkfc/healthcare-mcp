/**
 * Plain-Korean glossary for workout jargon shown in the card + Host LLM.
 */

export type GlossaryTermId =
  | "amrap"
  | "emom"
  | "rest_timer"
  | "stopwatch"
  | "rir"
  | "rpe"
  | "one_rm"
  | "max_reps"
  | "pct_1rm"
  | "phase"
  | "cid"
  | "hirt"
  | "liss"
  | "isolation"
  | "compound"
  | "unilateral"
  | "priority"
  | "epoc";

export type GlossaryTerm = {
  id: GlossaryTermId;
  /** Short label shown as the tappable chip. */
  label: string;
  /** One-line title in the popup. */
  title: string;
  /** Plain Korean explanation. */
  body: string;
  /** Optional example sentence. */
  example?: string;
};

export const workoutGlossary: Record<GlossaryTermId, GlossaryTerm> = {
  amrap: {
    id: "amrap",
    label: "AMRAP",
    title: "AMRAP (As Many Rounds As Possible)",
    body: "여러 개의 다관절 복합 운동을 하나로 묶은 운동 코스(루틴)를 순환하며 반복하는 방식입니다. 일반 웨이트처럼 5~7종목을 무겁게 하지 않고, 푸시업·턱걸이·스쿼트처럼 전신 대근육을 쓰는 3개 내외의 핵심 다관절만 묶어 맨몸이나 가벼운 무게로 중고반복합니다. 정해진 시간(기본 12분) 안에 최대한 많은 라운드를 돌리고, 마지막 세트는 실패 지점까지 합니다. 운동 중 휴식 시간이 길어지면 심박수가 떨어져 지방 연소 효율이 급감하므로, 단시간 내에 최대 칼로리를 소모하기 위해 시간을 통제합니다.",
    example: "예: 12분 동안 푸시업 → 턱걸이 → 스쿼트를 한 코스로 반복. 마지막 세트는 더 이상 바른 자세로 못 할 때까지.",
  },
  emom: {
    id: "emom",
    label: "EMOM",
    title: "EMOM (Every Minute On the Minute)",
    body: "매 분 시작과 동시에 목표 횟수를 하고, 그 분에 남은 시간은 쉽니다. 다음 분이 되면 다시 시작합니다. 운동 중 휴식 시간이 길어지면 심박수가 떨어져 지방 연소 효율이 급감하므로, 단시간 내에 최대 칼로리를 소모하기 위해 시간을 통제합니다.",
    example: "예: 매 분 스쿼트 10회 → 남으면 휴식 → 다음 분에 또 10회.",
  },
  rest_timer: {
    id: "rest_timer",
    label: "세트별 휴식",
    title: "세트별 휴식 타이머",
    body: "한 세트를 끝내면 타이머로 쉬는 시간을 재고, 시간이 끝나면 다음 세트를 합니다. 시간에 쫓기지 않고 호흡·폼을 회복할 때 씁니다.",
    example: "예: 12회 후 90초 휴식 → 다음 세트.",
  },
  stopwatch: {
    id: "stopwatch",
    label: "스톱워치",
    title: "스톱워치(자유 기록)",
    body: "제한 시간이나 분 단위 압박 없이, 운동에 걸린 총 시간만 잽니다. 페이스를 스스로 조절할 때 씁니다.",
  },
  rir: {
    id: "rir",
    label: "RIR",
    title: "RIR (Repetitions in Reserve, 여유 반복)",
    body: "세트가 끝났을 때 ‘앞으로 몇 번 더 들 수 있었는지’입니다. 0이면 한계, 2면 2번 더 들 여력이 있다는 뜻입니다.",
    example: "목표 RIR 2 = 끝났을 때 대략 2개 더 들 수 있을 정도로 힘 조절.",
  },
  rpe: {
    id: "rpe",
    label: "RPE",
    title: "RPE (Rate of Perceived Exertion)",
    body: "체감 난이도 점수(대략 1~10)입니다. RPE 8은 ‘꽤 빡세지만 2개 정도는 더 들 수 있음’으로, RIR 2와 비슷한 느낌입니다.",
  },
  one_rm: {
    id: "one_rm",
    label: "1RM",
    title: "1RM (One-Rep Max)",
    body: "딱 한 번만 들 수 있는 최대 무게입니다. 실제로 재지 않고, 가벼운 무게×횟수로 추정한 값을 쓰기도 합니다.",
  },
  max_reps: {
    id: "max_reps",
    label: "최대 횟수",
    title: "최대 횟수 (맨몸 1세트 최대)",
    body: "맨몸 동작에서 바른 자세로 한 세트에 더 이상 못 할 때까지 친 횟수입니다. 웨이트의 1RM처럼, 이 값을 기준으로 오늘 세트당 목표 횟수를 잡습니다.",
    example: "푸시업 최대 20회면 목표 대역·RIR을 반영해 세트당 10~18회처럼 내려 잡습니다.",
  },
  pct_1rm: {
    id: "pct_1rm",
    label: "%1RM",
    title: "%1RM (최대 무게 대비 비율)",
    body: "추정 1RM의 몇 %로 오늘 무게를 잡을지입니다. 예: 1RM이 100kg이면 70%1RM은 약 70kg입니다.",
    example: "근비대는 보통 60~80%1RM, 스트렝스는 80%1RM 이상을 많이 씁니다.",
  },
  phase: {
    id: "phase",
    label: "Phase",
    title: "Phase (단계)",
    body: "인바디 상태에 따라 운동 목표를 나눈 단계입니다. 1=좌우·기초 교정, 2=체성분 베이스, 3=워너비 체형 디테일입니다.",
  },
  cid: {
    id: "cid",
    label: "C-I-D",
    title: "C-I-D 체형",
    body: "인바디의 체중·골격근·체지방 비율로 보는 대략적 체형입니다. C=체지방 위주(커팅 쪽), I=비교적 균형, D=골격근·중량 쪽 성향으로 타이머·강도를 나눕니다.",
  },
  hirt: {
    id: "hirt",
    label: "HIRT",
    title: "HIRT (고강도 인터벌 저항운동)",
    body: "짧은 휴식의 근력 순환으로 심박·칼로리 소모를 올리는 방식입니다. AMRAP/EMOM과 자주 함께 쓰입니다.",
  },
  liss: {
    id: "liss",
    label: "LISS",
    title: "LISS (저강도 지속 유산소)",
    body: "빠르게 숨이 차지 않는 강도로 오래 걷는·자전거 타는 식의 유산소입니다. 심혈관 부담을 줄일 때 우선합니다.",
  },
  isolation: {
    id: "isolation",
    label: "고립",
    title: "고립 운동 (Isolation)",
    body: "관절 하나·근육 하나에 집중하는 동작입니다. 예: 레터럴 레이즈, 레그컬.",
  },
  compound: {
    id: "compound",
    label: "복합",
    title: "다관절 복합 운동 (Compound)",
    body: "여러 관절·큰 근육을 한꺼번에 쓰는 동작입니다. 예: 스쿼트, 데드리프트, 로우.",
  },
  unilateral: {
    id: "unilateral",
    label: "편측",
    title: "편측 운동 (Unilateral)",
    body: "한쪽 팔·다리만으로 하는 운동입니다. 좌우 차이를 맞출 때 약한 쪽부터 같은 횟수로 합니다.",
  },
  priority: {
    id: "priority",
    label: "우선 배치",
    title: "Priority Principle (취약 부위 우선)",
    body: "가장 약한 부위를 운동 순서 맨 앞에 두는 원칙입니다. 앞쪽에 배치할수록 힘이 남아 있어 효과가 큽니다.",
  },
  epoc: {
    id: "epoc",
    label: "애프터번",
    title: "EPOC / 애프터번",
    body: "운동이 끝난 뒤에도 잠시 대사량이 높게 유지되는 현상입니다. 짧은 휴식의 인터벌 저항운동에서 자주 언급됩니다.",
  },
};

export function glossaryList(): GlossaryTerm[] {
  return Object.values(workoutGlossary);
}
