/**
 * Consumer-facing scientific citations for workout prescriptions.
 * Shown when the user asks "why?" / "근거가 뭐야?" — Host LLM + workout card.
 */

export type EvidenceTopic =
  | "cross_education"
  | "priority_principle"
  | "hirt_ree"
  | "rest_intervals"
  | "rir_rpe"
  | "load_autoreg"
  | "double_progression";

export type EvidenceEntry = {
  id: EvidenceTopic;
  title: string;
  /** Short coach-facing answer when the user doubts the prescription. */
  pitch: string;
  /** Typical user questions this citation answers. */
  questions: string[];
  links: Array<{ label: string; url: string }>;
};

export const workoutEvidenceCatalog: EvidenceEntry[] = [
  {
    id: "cross_education",
    title: "교차 교육 · 편측 운동 (rest_timer)",
    pitch:
      "한쪽만 훈련해도 반대쪽 근력이 평균 11.9%(하지 최대 16.4%) 유지·전이됩니다. 시간에 쫓기거나 양손을 동시에 쓰면 강한 쪽이 부하를 뺏는 보상 작용이 커지므로, 휴식 타이머로 약한 쪽부터 같은 횟수로 맞춥니다.",
    questions: [
      "왜 바벨 안 쓰고 덤벨로 약한 쪽부터 해?",
      "왜 시간 제한 없이 휴식하면서 해?",
      "비대칭인데 AMRAP 하면 안 돼?",
    ],
    links: [
      {
        label: "Manca et al. (2017) Cross-education meta-analysis",
        url: "https://www.researchgate.net/publication/319966488_Cross-education_of_muscular_strength_following_unilateral_resistance_training_a_meta-analysis",
      },
      {
        label: "Green & Gabriel (2018) Neural transfer review",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6139459/",
      },
    ],
  },
  {
    id: "priority_principle",
    title: "취약 부위 우선 배치 (Priority Principle)",
    pitch:
      "루틴 맨 앞 종목에서 1RM·신경근 적응이 가장 크게 납니다. 후반으로 갈수록 CNS 피로로 볼륨이 줄어드니, 인바디상 가장 약한 부위를 첫 순서로 둡니다.",
    questions: [
      "왜 이 운동부터 먼저 하라고 한 거야?",
      "운동 순서는 왜 이렇게 짜여 있어?",
    ],
    links: [
      {
        label: "Nunes et al. (2021) Exercise order meta-analysis",
        url: "https://pubmed.ncbi.nlm.nih.gov/32077380/",
      },
    ],
  },
  {
    id: "hirt_ree",
    title: "C자형 HIRT / AMRAP·EMOM (애프터번)",
    pitch:
      "휴식이 짧은 고강도 인터벌 저항운동(HIRT)은 일반 웨이트 대비 운동 후 22시간 안정시 대사량(REE)을 약 23.7% 더 올려 체지방 연소에 유리합니다. C자형에 AMRAP/EMOM을 기본으로 두는 근거입니다.",
    questions: [
      "C자형인데 쉬엄쉬엄 하면 안 돼?",
      "왜 스톱워치 말고 AMRAP이야?",
    ],
    links: [
      {
        label: "Paoli et al. (2012) HIRT resting energy expenditure",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3551736/",
      },
    ],
  },
  {
    id: "rest_intervals",
    title: "세트 간 휴식 시간 (D자형·근비대)",
    pitch:
      "60초 이하로 너무 짧게 쉬면 세트 후반 총 볼륨이 급감합니다. 고립 60~120초, 다관절 복합은 최대 약 180초까지 휴식을 보장해야 근비대 볼륨이 유지됩니다.",
    questions: [
      "D자형은 왜 길게 쉬어?",
      "세트 사이 휴식을 줄이면 안 돼?",
    ],
    links: [
      {
        label: "Singer et al. (2024) Rest interval meta-analysis",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11349676/",
      },
    ],
  },
  {
    id: "rir_rpe",
    title: "RIR/RPE 자율조절",
    pitch:
      "인바디 근육량(kg)만으로는 신경계 동원율을 알 수 없습니다. 여유 반복 수(RIR)로 상대 강도를 맞추면 부상 위험을 줄이면서 목표 %1RM 대역을 유지할 수 있습니다.",
    questions: [
      "인바디 근육량만 보고 무게 정해줄 순 없어?",
      "RIR이 뭐야?",
    ],
    links: [
      {
        label: "Helms et al. (2016) RIR-based RPE scale",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4961270/",
      },
    ],
  },
  {
    id: "load_autoreg",
    title: "세트 간 ±4% 중량 보정",
    pitch:
      "목표 RIR보다 빡세거나 가벼우면 다음 세트 무게를 ±4% 단위로 즉시 보정합니다. 실패·미달 시에는 미달 횟수만큼 추가로 감량해 CNS 피로와 부상을 막습니다.",
    questions: [
      "왜 세트마다 무게를 바꿔?",
      "억지로라도 무겁게 드는 게 낫지 않아?",
    ],
    links: [
      {
        label: "Set-to-set ±4% load autoregulation protocol",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11766398/",
      },
    ],
  },
  {
    id: "double_progression",
    title: "더블 프로그레션 (횟수 우선)",
    pitch:
      "같은 무게에서 목표 횟수 범위만 먼저 늘려도(예: 8→12회) 중량을 올린 것과 동등한 근비대(약 6.7~12.9%)가 납니다. 자세가 무너지는 고중량보다 횟수 우선이 안전합니다.",
    questions: [
      "무게만 올리는 게 낫지 않아?",
      "횟수만 늘려도 근육이 커져?",
    ],
    links: [
      {
        label: "Plotkin et al. (2022) Rep progression hypertrophy",
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/",
      },
    ],
  },
];

export const evidenceRedirectDomains = [
  "https://pmc.ncbi.nlm.nih.gov",
  "https://pubmed.ncbi.nlm.nih.gov",
  "https://www.researchgate.net",
] as const;

/** Pick citations that match today's plan context. */
export function evidenceForPlan(input: {
  isImbalanced: boolean;
  shape: "C" | "I" | "D";
  phase: 1 | 2 | 3;
  recommendedMode: string;
  hasWeakPriority: boolean;
}): EvidenceEntry[] {
  const ids = new Set<EvidenceTopic>();
  if (input.isImbalanced || input.phase === 1) {
    ids.add("cross_education");
  }
  if (input.hasWeakPriority) {
    ids.add("priority_principle");
  }
  if (input.shape === "C" || input.recommendedMode === "amrap" || input.recommendedMode === "emom") {
    ids.add("hirt_ree");
  }
  if (
    input.shape === "D" ||
    input.recommendedMode === "rest_timer" ||
    input.phase >= 2
  ) {
    ids.add("rest_intervals");
  }
  ids.add("rir_rpe");
  ids.add("load_autoreg");
  ids.add("double_progression");

  return workoutEvidenceCatalog.filter((item) => ids.has(item.id));
}

/** Compact block for Host LLM tool/model text. */
export function formatEvidenceForModel(entries: EvidenceEntry[]): string {
  if (entries.length === 0) return "";
  return entries
    .map((item) => {
      const links = item.links.map((l) => `${l.label}: ${l.url}`).join(" | ");
      return `- [${item.id}] ${item.title}: ${item.pitch} Links: ${links}`;
    })
    .join("\n");
}
