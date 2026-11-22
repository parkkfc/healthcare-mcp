인바디(InBody) 데이터 기반 과학적 운동 처방과 1RM·자율조절(Autoregulation) 부하 설정 프레임워크
인바디(InBody) 체성분 분석 결과만으로 AI가 사용자에게 '어떤 운동을, 어떤 순서와 진행 모드(타이머)로 수행해야 하는가'는 높은 스포츠과학적 타당성으로 결정할 수 있으나, '구체적으로 몇 kg의 바벨·덤벨을 몇 회 들어야 하는가(절대 중량)'를 인바디 근육량(kg)에서 직접 도출하는 것은 생리학적으로 불가능하며 부상 위험을 초래합니다. 따라서 과학적인 AI 운동 추천 코스는 ① 인바디 체성분·분절 근육량 기반의 구조적 처방(운동 종목·순서·휴식/인터벌 모드 결정)과 ② 최대하(Submaximal) 1RM 추정 공식 및 RIR/RPE(여유 반복 수/운동자각도) 기반의 기능적 부하 보정(적정 무게·횟수·점진적 과부하 유도)을 결합한 2단계 하이브리드 의사결정 아키텍처로 설계해야 합니다.
첫째, 인바디의 5대 분절 근육량(상체 좌/우, 몸통, 하체 좌/우)과 C-I-D 체형 지표는 신경근 피로 관리(우선순위 원칙), 양측성 결손(Bilateral Deficit) 및 교차 교육(Cross-Education)을 활용한 비대칭 교정, 운동 후 초과 산소섭취량(EPOC) 극대화라는 생리학적 기전을 통해 루틴의 골격을 결정합니다. 둘째, 근육의 단면적(CSA)이나 제지방량(FFM)은 신경계 동원 능력(Motor Unit Recruitment), 근섬유 우상각(Pennation Angle), 세포외수분비(ECW/TBW) 등에 따라 실제 발휘 근력과 비선형적으로 분리(Dissociation)되므로, 개별 종목의 작업 중량(Working Weight)과 반복 횟수는 Epley·Brzycki·Wathen·Mayhew 등 1RM 추정 방정식의 역산과 Zourdos·Helms의 RIR 기반 RPE 자율조절 프로토콜(세트 간 ±4% 중량 보정) 및 ACSM 2-for-2 더블 프로그레션(Double Progression)을 통해 사용자 스스로 안전하게 탐색·확정하도록 유도해야 합니다.
1. 인바디(InBody) 지표 기반 과학적 운동 코스 설계 원리
직접분절 다주파수 생체전기임피던스(DSM-MFBIA) 방식의 인바디는 인체를 5개의 독립된 원통(좌/우 상지, 몸통, 좌/우 하지)으로 계측합니다. 제조사 임상 매뉴얼(Mayo Clinic 연구 인용) 및 학술 학위논문에 따르면 이중 에너지 X선 흡수계측법(DEXA)과 제지방량·체지방률 추정에서 98~99%의 높은 상관관계를 보이지만, 독립 검증 연구들은 DEXA 대비 일정 수준의 체계적 편향(예: 노년층 사지 제지방량에서 평균 -0.60 ± 1.21 kg 과소추정 또는 몸통 제지방량 -1.29 kg 차이)과 수분 상태에 따른 변동성이 존재함을 함께 지적합니다. 따라서 AI가 인바디 결과지(save-inbody)에서 추출한 데이터를 바탕으로 운동 코스를 설계하고 사용자를 설득(persuasionPending)할 때는 단순 수치 맹신이 아닌 다음 4가지 운동생리학적 원칙을 적용해야 합니다.
1.1 사전 임상 스크리닝 및 안전 가드레일 (Clinical Safety Gate)
AI가 운동 강도와 모드를 배정하기 전, 인바디 결과지의 두 가지 생리학적 위험 지표를 최우선으로 필터링해야 합니다. 첫째는 세포외수분비(ECW/TBW Ratio)에 따른 피로·부종 통제입니다. 정상적인 세포 수분 균형은 0.380 미만이며, 0.380~0.390 구간은 미세 염증 누적 또는 근육의 질적 저하가 시작되는 경계선입니다. 만약 ECW/TBW > 0.390(인바디 상한 기준선)이 감지되면 전신 염증, 부종, 또는 과훈련으로 인한 회복 불량 상태일 가능성이 높으므로 고강도 인터벌(AMRAP/EMOM)이나 고중량 훈련을 즉시 유예하고 저강도 회복 루틴 및 전문의 상담을 안내해야 합니다. 또한 공복 2~4시간 미준수, 측정 전 6~12시간 이내 고강도 운동 수행, 크레아틴 복용 등 측정 프로토콜 위반 시 일시적인 체수분 이동으로 제지방량이 왜곡될 수 있음을 AI가 함께 고지해야 합니다.
둘째는 내장지방레벨(Visceral Fat Level, VFL)에 따른 심혈관 보호입니다. VFL 1~9는 건강한 범위이나, VFL ≥ 10(내장지방 단면적 약 100 cm² 이상)부터는 심혈관 및 대사 주의 구간(10~14 경계, 15 이상 고위험군)에 해당합니다. 따라서 C자형 비만 사용자 중 VFL ≥ 10인 경우, 첫날부터 극단적인 고강도 인터벌(HIIT)을 배정하면 심혈관계 부담이 크므로 저강도 지속성 유산소(LISS)와 기초 다관절 저항운동을 우선 배정해야 합니다.
1.2 좌우 비대칭(Inter-Limb Asymmetry) 판별과 편측성(Unilateral) 처방의 신경생리학
인바디 분절 근육 분석(Segmental Lean Analysis)에서 상지 좌우(muscleUpperLeftKg vs muscleUpperRightKg) 또는 하지 좌우(muscleLowerLeftKg vs muscleLowerRightKg)의 불균형을 계산할 때, 스포츠과학 문헌(Bishop et al., 2018, 2021, 2026)은 분수 계산의 수학적 일관성을 위해 최댓값 기준 상대 백분율 공식을 표준으로 제시합니다:
\text{Asymmetry Index (\%)} = \left( \frac{\max(L, R) - \min(L, R)}{\max(L, R)} \right) \times 100 = 100 - \left( \frac{\min(L, R)}{\max(L, R)} \times 100 \right)
동적 퍼포먼스 테스트(외발 점프, 등속성 근력 등)에서는 전통적으로 10% 이상(Kyritsis et al., 2016; Rohman et al., 2015) 또는 15% 이상(Barber et al., 1990; Noyes et al., 1991)의 차이를 부상 위험 및 수직점프·방향전환(CODS) 능력 저하의 기준선으로 삼아 왔습니다. 다만 Bishop 등(2021, 2026)의 체계적 문헌고찰은 10~15%라는 획일적 임계치가 과제 특이적(Task-specific)이며, 측정 지표의 변이계수(CV, 측정 오차)보다 비대칭률이 클 때만 실제 불균형으로 간주해야 하고 대칭성 못지않게 양측의 절대 근력 수준을 함께 평가해야 한다고 강조합니다. 인바디가 측정하는 형태학적 분절 제지방량(kg)은 점프력 같은 동적 출력보다 변동 폭이 좁기 때문에, 본 시스템(Hands-On Diet)에서는 좌우 근육량 차이가 5% 이상(또는 0.2~0.3 kg 이상) 벌어지면 isImbalanced: true 플래그를 활성화하여 교정 루틴을 우선 배정합니다.
비대칭이 감지되었을 때 바벨(양측성) 운동을 배제하고 덤벨·케이블·스플릿 스쿼트 등 편측성(Unilateral) 운동과 rest_timer(세트별 휴식 타이머)를 기본 배정해야 하는 과학적 근거는 세 가지로 요약됩니다. 첫째, 양측성 운동 시 강한 쪽 사지가 부하를 비대칭적으로 분담하여 약한 쪽의 기계적 장력을 빼앗는 보상 작용을 차단하고, 양측 동시 수축보다 편측 독립 수축 시 단위 사지당 발휘 가능한 상대적 부하가 커지는 양측성 결손(Bilateral Deficit, Howard & Enoka, 1991; Bobbert et al., 2006) 현상을 역이용할 수 있습니다. 둘째, Manca 등(2017)이 785명의 피험자를 대상으로 수행한 메타분석에 따르면, 한쪽 사지의 편측성 저항운동은 신경학적 교차 교육(Cross-Education) 현상을 통해 반대쪽 사지에서도 평균 11.9%(95% CI: 9.1~14.8%, p < 0.00001)의 근력 향상을 유도합니다. 부위별로는 상지(+9.4%)보다 하지(+16.4%)에서, 수축 유형별로는 등척성(+8.2%)이나 단축성(+11.3%)보다 등장성-동적 수축(+15.9%) 및 신장성 수축(+17.7%)에서 전이 효과가 크며, 건강한 청년층에서는 최대 18%에 달합니다(Green & Gabriel, 2018). 셋째, 시간에 쫓기는 인터벌 모드를 수행하면 중추 피로 속에서 무의식적으로 우세측을 과사용하므로, 반드시 rest_timer(60~90초 이상 휴식) 모드에서 약한 쪽부터 세트를 시작하고 강한 쪽은 약한 쪽이 완수한 횟수까지만 동일하게 수행하도록 통제해야 밸런스가 회복됩니다.
1.3 분절 상대 밸런스 판독과 운동 순서의 우선순위 원칙 (Exercise Order Priority Principle)
인바디 5대 부위의 상대적 취약 부위(weakParts)를 추출할 때 단순 절대 중량(kg)만 비교하면 해부학적 질량 비례 때문에 항상 상지가 부족한 것으로 오판하게 됩니다. 실제로 건강한 정상 체중 청년층(PMC9547056, n = 92)의 평균 분절 제지방량은 상지 합계 4.0 ± 0.6 kg, 몸통 20.2 ± 2.4 kg, 하지 합계 13.6 ± 1.9 kg(사지 합계 ALM 17.6 ± 2.3 kg)으로, 5분절 합계 대비 상지는 좌우 각 약 5.3%(합계 10.6%), 몸통은 약 53.4%, 하지는 좌우 각 약 18.0%(합계 36.0%)이며 하지 총합이 상지 총합의 약 3.4배를 차지합니다.
따라서 AI 분석 엔진(src/inbody-analyzer.ts)은 결과지에 표기되는 부위별 표준 체중 대비 백분율(100% 기준, 정상 범위 90~110%) 중 100% 미만이면서 가장 수치가 낮은 분절을 최우선 취약 부위로 추출해야 합니다. 특히 하체 백분율이 100% 미만으로 떨어지거나 사지 근육량 지수(\text{ALMI} = \text{ALM} / \text{신장}^2)가 근감소증 임상 기준선(AWGS 2019 아시아 기준: 남성 < 7.0 kg/m², 여성 < 5.4 kg/m²; EWGSOP2 유럽 기준: 남성 < 7.0 kg/m², 여성 < 5.5 kg/m²)에 근접하면 낙상 위험 및 대사 질환 예방을 위해 하체 근력 보강을 최우선으로 배정합니다. 백분율 없이 kg 수치만 입력된 경우에는 표준 분절 구성비 및 하지/상지 비율(또는 앱 내 간소화 기준인 lower < upper 상대 비교)을 통해 취약 부위를 판별합니다.
추출된 취약 부위 운동을 루틴의 맨 첫 번째 순서에 배치해야 하는 과학적 근거는 Simão 등(2012, Sports Medicine)의 종설과 Nunes 등(2021, European Journal of Sport Science)의 체계적 문헌고찰 및 메타분석(11개 연구 통합)에서 확인됩니다. 전통적인 지침은 무조건 '대근육(다관절)에서 소근육(단일관절) 순서'를 권장했으나, 메타분석 결과 근비대 효과는 운동 순서와 무관하게 비슷했던 반면(효과크기 ES = 0.03, p = 0.862), 근력 향상(1RM 증가)은 관절 수나 근육 크기와 상관없이 세션의 맨 처음에 배치된 종목에서 유의하게 더 크게 나타났습니다(종목 순서 간 차이 ES = -0.58, p = 0.032; 다관절 선배치 시 다관절 근력 우세 ES = 0.32, p = 0.034). 세션 후반부로 갈수록 중추신경계 피로가 누적되어 총 반복 횟수와 볼륨 부하가 급감하므로(p < 0.001), 인바디에서 가장 취약한 부위를 피로도가 없는 첫 번째 순서에 배치해야 최대의 신경근 적응을 이끌어낼 수 있습니다.
1.4 C-I-D 체형별 운동 종목(다관절 vs 단일관절) 및 타이머 모드 매핑 근거
체중·골격근량·체지방량 막대의 끝점을 연결한 C-I-D 체형 판독 결과에 따라 운동 종목 구성과 진행 타이머(amrap, emom, rest_timer)를 차별화하는 생리학적 근거는 다음과 같습니다:
인바디 체형 및 상태
체성분 특징 및 판독 기준
권장 운동 종목 구성
자동 설정 타이머 모드
핵심 운동생리학적 근거 (AI 설득 논리)
좌우 비대칭형 (isImbalanced: true)
상·하체 좌우 근육량 차이 ≥ 5% (또는 ≥ 0.2~0.3 kg)
편측성(Unilateral) 운동 (덤벨, 케이블, 스플릿 스쿼트)
⏱️ 세트별 휴식 타이머 (rest_timer: 60~120초)
• 양측성 결손(Bilateral Deficit) 극복 및 강한 쪽 보상 작용 차단 • 교차 교육(Cross-Education): 반대측 사지 근력 평균 +11.9%(하지 +16.4%) 신경 전이 • 약한 쪽 선행 및 횟수 동일 통제를 위한 충분한 휴식 필수
C자형 (비만·근부족) (Phase 1~2 커팅/베이스)
체중 대비 골격근량 부족(< 90%), 체지방률 과다(ACSM 권장 남 10~20%, 여 18~28% 초과; 성인 위험군 남 > 25%, 여 > 30%)
다관절 복합 운동(MJ) 전용 (스쿼트, 푸시업, 로우, 풀다운 등 대근육 통합)
🔥 AMRAP 또는 🔔 EMOM (제한시간 최대 라운드 / 1분 인터벌)
• de França, Gentil et al. (2015): 다관절(MJ) 단독 루틴은 고립 운동(SJ) 추가 루틴과 동등한 근력·근비대를 달성하며 1시간 이상 운동 시 발생하는 중도 탈락률(~30%, Hass et al., 2000)을 예방 • Paoli et al. (2012): 32분 고강도 인터벌 저항운동(HIRT)은 62분 일반 웨이트 대비 22시간 후 안정시 대사량(REE)을 +23.7%(2,362 vs 1,999 kcal/일) 높이고 호흡교환율(RR)을 0.798로 낮춰 지방 산화를 극대화(+3.5%)
I자형 (표준·균형형) (Phase 2~3 체력·균형)
체중·골격근량(90~110%)·체지방량이 일직선상에 균형 분포
다관절 복합(MJ) + 코어/부위 보완 운동 결합
🔔 EMOM 모드 (1분 단위 페이스메이커) 또는 ⏱️ 휴식 타이머
• 휴식 시간 지연을 방지해 운동 밀도(단위 시간당 작업량)를 일정하게 유지하고 심폐 지구력과 근비대 자극을 동시 확보
D자형 (강인·근비대형) (Phase 3 디테일 조각)
골격근량 표준 이상(> 110%), 체지방률 적정 범위, 전 분절 ≥ 100%
취약 부위 선배치 + 단일관절 고립(SJ) 분할 추가
⏱️ 세트별 휴식 타이머 (rest_timer: 고립 60~120초, 복합 120~180초)
• Singer et al. (2024) & Schoenfeld et al. (2016): 60초 이하 단시간 휴식은 세트 반복 횟수와 총 볼륨 부하를 급감시킴. 60초 초과(복합 2~3분) 휴식이 볼륨 부하와 근비대를 보존 • 다관절 운동만으로는 자극이 부족한 슬와부근(Knee flexion)이나 특정 근육 부위를 다양한 고립(SJ) 동작으로 정밀 타격
2. 과학적 한계 규명: 왜 인바디 수치만으로 정확한 운동 무게(kg)를 정할 수 없는가?
사용자 질의의 핵심 전제인 "만약 인바디만으로 운동을 처방할 적절한 과학적 근거가 없다면 1RM 공식을 알려주고 적정 무게·횟수를 유도하라"는 통찰은 현대 스포츠과학의 검증 결과와 정확히 부합합니다. 결론부터 말하면, 인바디의 골격근량(SMM)이나 부위별 근육량(kg)만을 대입해 개인의 스쿼트·벤치프레스 1RM(1회 최대 거상 중량)을 직접 산출하는 정확한 수학적·임상적 공식은 존재하지 않습니다.
2.1 인체계측·체성분 변수 기반 1RM 직접 예측의 한계
집단 통계 수준에서는 제지방량(FFM)이나 체중이 1RM 근력과 유의한 상관관계를 보이며, 일부 연구에서는 초보자 프론트 스쿼트 1RM 초기 추정치로 체중 비례 계수(남성 체중 × 1.25, 여성 체중 × 0.90)를 임시 기준점으로 사용하기도 합니다. 그러나 Kravitz 등(2003), Mayhew 등(2004), Whisenant 등(2003), Reynolds 등(2006)의 검증 연구에 따르면, 신장·체중·제지방량(FFM)·체지방률 등 체성분 및 인체계측 변수를 회귀식에 투입하더라도 실제 1RM 예측 정확도는 거의 개선되지 않았습니다. 오히려 인체계측 변수를 포함한 예측식이 실제 1RM 퍼포먼스를 2.9~11.8% 과대평가(Over-predict)하여 임상적 허용 오차 범위(±10 lbs, 약 ±4.5 kg) 내에 진입하지 못했습니다(Mayhew et al., 2004).
2.2 근육량(CSA/Mass)과 발휘 근력(Strength)이 비선형적으로 분리되는 4가지 생리학적 이유
Moritani와 deVries(1979)의 고전적 연구와 Reggiani와 Schiaffino(2020, PMC7582410)의 종설은 동일한 근육량(kg)을 가진 두 사람이 전혀 다른 중량을 드는 이유를 네 가지 기전으로 설명합니다. 첫째, 신경계 적응(Neural Factors)의 독립성입니다. 근력 발현은 근육의 크기 이전에 운동단위 동원율(Motor unit recruitment), 발화 빈도(Firing rate), 그리고 길항근 동시수축 억제(Antagonist de-activation)에 의해 좌우되며, 훈련 초기의 근력 상승은 근비대 없이 신경계 적응만으로 일어납니다. 둘째, 비대의 질적 차이(Specific Tension)와 세포외수분(ECW)입니다. 근섬유 성장은 실제 수축 요소인 근원섬유(Myofibrils) 비대와 비수축성 요소인 근형질(Sarcoplasm) 및 세포외기질(ECM) 확장으로 나뉘며, 이 비율에 따라 단위 단면적당 최대 등척성 장력(Specific Tension)이 달라집니다. 특히 인바디(BIA)는 체수분을 통해 근육량을 추정하므로 수분 보유량에 따라 근육량(kg)이 높게 측정된 사용자가 실제 수축력은 낮을 수 있습니다. 셋째, 근육 구조(Pennation Angle) 및 건 탄성(Tendon Compliance)의 차이로 인해 근비대 과정에서 우상각이 변하거나 건의 신장성이 달라지면 내부 근섬유 장력이 외부 뼈와 바벨로 전달되는 효율이 분리됩니다. 넷째, 운동 기술 및 개인별 반응 차이(Inter-individual Variability)로 인해 근육량 증가가 적은 사람(Low responder)도 상당한 근력 향상을 이루는 반면, 근육 크기가 커져도 기능적 근력 향상은 미미한 사례가 빈번히 관찰됩니다.
따라서 AI는 사용자에게 "인바디는 회원님의 어느 근육이 부족하고 좌우가 얼마나 비대칭인지 알려주는 정밀한 '신체 지도'이지만, 근육의 신경계 출력 효율은 직접 들어봐야 정확히 알 수 있습니다. 부상 없이 회원님만의 적정 무게를 찾기 위해 최대하 1RM 추정 공식과 여유 반복 수(RIR) 보정법을 적용합니다"라고 명확한 근거를 제시해야 합니다.
3. 과학적 1RM(1회 최대 반복 중량) 추정 공식 및 역산 알고리즘
1RM 직접 측정(1회 한계 중량 도전)은 시간이 많이 걸리고 비숙련자나 비만·비대칭 사용자에게 부상 위험을 높입니다(Chapman et al., 1998). 이에 스포츠과학계는 최대하 중량(w)으로 수행한 반복 횟수(r)를 통해 안전하게 1RM을 추정하는 RTF(Repetitions to Fatigue) 예측 방정식을 확립했습니다.
3.1 7대 표준 1RM 추정 방정식 및 목표 중량(w) 역산 공식
사용자가 특정 중량 w(kg)로 r(회)를 수행했을 때 1RM을 산출하는 정방향 공식과, 반대로 목표 반복 횟수(r)에 맞는 추천 작업 중량(w)을 역산하는 공식은 다음과 같습니다:
공식명 (발표 연도)
수학적 모델 유형
1RM 추정 정방향 공식 (r > 1)
목표 횟수(r)에 대한 적정 중량(w) 역산 공식
5RM 시 %1RM
10RM 시 %1RM
학술적 검증 특징 및 최적 적용 종목 (LeSuer et al., 1997 외)
Epley (1985)
선형 (Linear)
1\text{RM} = w \times \left(1 + \frac{r}{30}\right)
w = \frac{1\text{RM}}{1 + \frac{r}{30}}
85.7% (교과서 표 86%)
75.0%
• 가장 널리 쓰이는 범용 공식 (1회당 약 3.33% 가산) • 10회 초과 시 1RM을 과대평가하는 경향
Brzycki (1993)
쌍곡선/선형 (Hyperbolic)
1\text{RM} = w \times \frac{36}{37 - r[span_165](start_span)[span_165](end_span)[span_167](start_span)[span_167](end_span)}
w = \frac{1\text{RM} \times (37 - r)}{36}
88.9% (교과서 표 89%)
75.0%
• 1~10회 이하 구간에서 보수적이고 안전한 추정치 제공 • 10회에서 Epley와 정확히 일치(1.333w), 12회 초과 시 급격히 발산
Wathen (1994)
지수 감쇠 (Exponential)
1\text{RM} = \frac{100w}{48.8 + 53.8e^{-0.075r}}
w = \frac{1\text{RM} \times (48.8 + 53.8e^{-0.075r})}{100}
85.8% (교과서 표 86%)
74.2% (교과서 표 74%)
• 스쿼트(오차 2% 이내)와 벤치프레스(오차 1% 이내) 모두에서 실제 1RM과 유의한 차이가 없었던 유일한 공식 (NSCA 차트 기반)
Mayhew et al. (1992)
지수 감쇠 (Exponential)
1\text{RM} = \frac{100w}{52.2 + 41.9e^{-0.055r}}
w = \frac{1\text{RM} \times[span_177](start_span)[span_177](end_span)[span_179](start_span)[span_179](end_span) (52.2 + 41.9e^{-0.055r})}{100}
84.0%
76.4% (교과서 표 76%)
• 상체 프레스(벤치프레스)에서 가장 높은 정확도 입증(오차 1% 이내, r = 0.80~0.91, SEE = ±6.4%)
Lombardi (1989)
멱함수 (Power)
1\text{RM} = w \times r^{0.10}
w = \frac{1\text{RM}}{r^{0.10}}
85.1% (교과서 표 85%)
79.4% (교과서 표 79%)
• 반복 횟수가 늘어날수록 증가 폭이 둔화되는 보수적 모델
O'Conner et al. (1989)
선형 (Linear)
1\text{RM} = w \times (1 + 0.025r)
w = \frac{1\text{RM}}{1 + 0.025r}
88.9%
80.0%
• 1회당 2.5%만 가산하는 가장 보수적인 공식으로 초보자 과부하 방지에 유리
Lander (1985)
선형 역수 (Linear)
1\text{RM} = \frac{100w}{101.3 - 2.67123r}
w = \frac{1\text{RM} \times (101.3 - 2.67123r)}{100}
88.0%
74.6% (교과서 표 74%)
• 저반복 구간용이나 12~15회 이상에서 신뢰도 급락
또한 Reynolds 등(2006, JSCR)이 18~69세 남녀 70명을 대상으로 도출한 종목 특화 5RM 기반 선형 회귀식은 머신·다관절 운동에서 매우 높은 설명력을 보입니다:
체스트프레스/벤치프레스(CP): 1\text{RM} = 1.1307 \times (5\text{RM 중량 [kg]}) + 0.6999 (R² = 0.993, SEE = 2.98 kg)
레그프레스(LP): 1\text{RM} = 1.0970 \times (5\text{RM 중량 [kg]}) + 14.2546 (R² = 0.974, SEE = 16.16 kg)
3.2 AI 운동 추천 엔진에 적용할 3가지 수리적 보정 규칙
단순히 하나의 공식을 무작정 대입하면 운동 현장에서는 오차가 발생하므로, AI가 1RM 공식을 호출할 때는 세 가지 수리적 보정 규칙을 적용해야 합니다.
첫째는 '10회 이하(r ≤ 10)' 유효 입력 제한 규칙입니다. Reynolds 등(2006)과 Brzycki(1993)는 선형 방정식을 통한 1RM 추정에 사용되는 반복 횟수가 절대 10회를 초과해서는 안 된다고 명시합니다. 1~2회 구간에서 가장 큰 %1RM 낙폭이 발생한 뒤 3~10회 구간에서는 비교적 선형적인 관계를 유지하지만(Mayhew et al., 1992), 10회를 넘어서는 순간 비선형 피로 오차가 급증합니다(체스트프레스 선형 표준오차 Sy.x = 2.6 kg vs 비선형 0.2 kg). 따라서 앱에서는 10회 이하(최대 12회)의 세트 기록만으로 1RM을 갱신하도록 제한해야 합니다.
둘째는 상·하체 및 데드리프트 종목별 공식 분기(LeSuer et al., 1997; Nuzzo et al., 2024)입니다. LeSuer 등(1997)이 대학생 67명을 대상으로 7개 공식을 교차 검증한 결과, 벤치프레스에서는 Mayhew 공식과 Wathen 공식만이 오차 1% 이내로 실제 1RM과 유의한 차이가 없었으며(나머지 5개 공식은 1~6% 과소추정), 스쿼트에서는 Wathen 공식만이 오차 2% 이내로 유의한 차이가 없었습니다(나머지 6개 공식은 3~8% 과소추정). 반면 데드리프트에서는 7개 공식 모두 실제 1RM을 9~14% 과소평가했으므로, 데드리프트는 3~5회 이하의 저반복 세트에서 Brzycki 공식(또는 7개 공식 평균)을 사용하는 것이 권장됩니다. 또한 Hoeger 등(1990)과 Nuzzo 등(2024, Sports Medicine 메타회귀분석)이 규명했듯, 동일한 80% 1RM 중량에서도 벤치프레스는 평균 9회를 수행하는 반면 레그프레스는 평균 13회를 수행합니다(90% 1RM에서는 벤치프레스 4회 vs 레그프레스 9회; 70% 1RM에서는 벤치프레스 14회 vs 레그프레스 19회). 따라서 하체 다관절 머신 운동에서 고반복 기록을 Epley 공식에 그대로 넣으면 1RM이 약 15% 과대평가되므로 종목별 차등 적용이 필수적입니다.
셋째는 실패 지점까지 가지 않은 세트의 '유효 반복수(r_{\text{eff}})' 보정입니다. 모든 고전 1RM 공식은 피험자가 실패 지점(Momentary Failure, 0 RIR / RPE 10)까지 들었을 때의 횟수(RTF)를 전제로 합니다. 그러나 일반 사용자가 매 세트를 실패 지점까지 수행하면 중추 피로와 부상 위험이 커집니다. 따라서 사용자가 wkg으로 r\text{ 회}$를 수행하고 **여유 반복 수(RIR, 더 할 수 있었던 횟수)**를 입력하면, **유효 반복수 reff=r+RIR**을 공식의 r 자리에 대입하여 실패 없이도 일일 추정 1RM($\text{e1RM})을 근사 산출할 수 있습니다:
\text{e1RM}_{\text{Wathen}} = \frac{100 \times w}{48.8 + 53.8 \times e^{-0.075 \times (r + \text{RIR})}}, \quad \text{e1RM}_{\text{Epley}} = w \times \left(1 + \frac{r + \text{RIR}}{30}\right)
4. 사용자 맞춤형 적정 무게·횟수 유도 및 자율조절(Autoregulation) 프로토콜
사용자가 자신의 1RM을 전혀 모르는 첫날부터, 매 세트 컨디션에 맞춰 무게를 조절하고, 주차별로 점진적 과부하를 달성하도록 유도하는 3단계 과학적 가이드라인입니다.
4.1 1단계: 운동 목표 및 워너비 체형별 적정 강도(%1RM)·횟수·볼륨 매핑
Schoenfeld 등(2021, Sports)의 '반복 횟수 연속체(Repetition Continuum) 재검토' 연구와 소련 역도 과학자 Prilepin의 차트 및 Hristov(2004)의 INOL(Intensity and Number of Lifts) 지수에 기반하여, AI는 사용자의 현재 단계(Phase 1~3)와 목표에 맞춰 기본 횟수와 %1RM을 설정합니다.
먼저 스트렝스 및 신경계 강화(고밀도 파워형 / Phase 3 스트렝스)가 목표일 때는 80~100% 1RM, 세트당 1~5회 반복을 배정합니다. Schoenfeld 등(2021)이 인용한 메타분석에 따르면 고중량(> 60% 1RM) 훈련은 저중량(≤ 60% 1RM) 훈련 대비 최대 근력(1RM) 향상에서 뚜렷한 우위(효과크기 ES = 0.58)를 보이며, 세트 간 휴식은 3~5분(180~300초)을 부여합니다. 다음으로 근비대 및 체형 조형(보디빌딩·상체·하체 집중형 / Phase 2~3)이 목표일 때는 60~80% 1RM, 세트당 8~12회 반복을 가장 실용적인 기본 구간으로 설정하되, 관절 부담이 있거나 홈트레이닝 환경일 경우 30~85% 1RM(6~30회)의 넓은 스펙트럼에서도 세트 종료 시점의 여유 반복 수(RIR)를 1~2개(RPE 8~9)로 맞추면 동등한 근비대가 일어납니다. 이때 세트 간 휴식은 단일관절(고립) 60~120초, 다관절(복합) 120~180초를 배정합니다(Singer et al., 2024). 마지막으로 국소 근지구력 및 체지방 연소·교정(C자형 감량 / Phase 1 비대칭·코어 정렬)이 목표일 때는 60% 1RM 미만(40~60% 1RM), 세트당 15회 이상 반복을 배정하여 관절 스트레스 없이 동작 제어 능력과 대사적 소비를 높입니다.
또한 중·고중량 훈련 시 총 몇 세트를 시켜야 피로 누적 없이 근력이 성장하는지 검증하기 위해 Prilepin 차트(55~65% 1RM: 세트당 3~6회, 최적 총 24회; 70~80% 1RM: 세트당 3~6회, 최적 총 18회[범위 12~24회]; 80~90% 1RM: 세트당 2~4회, 최적 총 15회[범위 10~20회]; 90%+ 1RM: 세트당 1~2회, 최적 총 7회[범위 4~10회])에서 파생된 INOL 공식을 백엔드 볼륨 제어에 활용합니다:
\text{INOL} = \sum \frac{\text{세트당 수행 횟수 (Reps)}}{100 - \text{상대 강도 (\%1RM)}}
단일 운동 종목당 1회 세션의 적정 INOL 범위는 0.4 ~ 1.0 (최적 시작점 0.7 ~ 0.8)입니다. 예를 들어 75% 1RM 중량으로 5회씩 5세트(총 25회)를 수행하면 \text{INOL} = 25 / (100 - 75) = 1.0으로 적정 상한선에 도달하며, 만약 80% 1RM에서 3회씩 10세트(총 30회)를 시키면 \text{INOL} = 30 / 20 = 1.5가 되어 Prilepin 권장 상한(24회)을 초과하고 과도한 중추신경계 피로를 유발합니다.
4.2 2단계: 초보자 첫 무게 탐색 및 Helms·Zourdos의 RIR/RPE 매핑 테이블
사용자가 처음 운동을 시작해 1RM 기록이 없을 때, AI는 NSCA 최대하 탐색 프로토콜(가벼운 워밍업 후 5~10% 또는 상체 2~4 kg / 하체 4~9 kg씩 점진 증량)과 Zourdos 등(2016) 및 Helms 등(2016, Strength and Conditioning Journal, PMC4961270)의 RIR(Repetitions in Reserve) 기반 RPE 척도를 결합해 첫 무게를 유도합니다.
사용자에게 *"가볍게 10회 내외를 바른 자세로 들 수 있을 것 같은 편안한 무게로 1세트를 먼저 수행한 뒤, 끝났을 때 '앞으로 몇 개를 더 들 수 있었는지(여유 반복 수, RIR)' 선택해 주세요"*라고 안내한 뒤, 사용자가 입력한 수행 횟수(r)와 체감 RIR/RPE를 아래 학술 매핑표(Helms et al., 2016, Table 2)와 대조하여 현재 무게의 상대 강도(%1RM)를 즉시 판별합니다:
상대 강도 (%1RM)
RPE 7.0 (3 RIR: 3개 여유)
RPE 7.5 (2~3 RIR)
RPE 8.0 (2 RIR: 2개 여유)
RPE 8.5 (1~2 RIR)
RPE 9.0 (1 RIR: 1개 여유)
RPE 9.5 (0~1 RIR: 한계 직전)
RPE 10.0 (0 RIR: 완전 실패)
100% 1RM
—
—
—
—
—
—
1회
95% 1RM
—
—
—
—
1회
—
2회
92% 1RM
—
—
—
1회
—
2회
3회
90% 1RM
—
—
1회
—
2회
3회
4회
87% 1RM
—
1회
—
2회
3회
4회
5회
85% 1RM
1회
—
2회
3회
4회
5회
6회
83% 1RM
—
2회
3회
4회
5회
—
6회
80% 1RM
2회
3회
4회
5회
6회
7회
8회
77% 1RM
3회
4회
5회
6회
7회
8회
9회
75% 1RM
4회
5회
6회
7회
8회
9회
10회
70% 1RM
6회
7회
8회
9회
10회
—
—
예를 들어 근비대(목표: 70% 1RM으로 8회 반복 @ RPE 8 / 2 RIR)가 목표인 사용자가 첫 세트에서 40 kg으로 8회를 든 뒤 "1개밖에 더 못 들 것 같아요(1 RIR = RPE 9)"라고 응답했다면, 위 조견표에 따라 현재 40 kg은 이 사용자에게 70%가 아니라 75% 1RM에 해당함을 알 수 있습니다.
4.3 3단계: 실시간 세트 간(Set-to-Set) 중량 보정과 주차별 더블 프로그레션(Double Progression)
세트가 진행됨에 따라 피로가 누적되거나 초기 중량 설정이 빗나갔을 때는 임상 무작위 대조군 연구(PMC11766398; Zourdos et al., 2016)에서 검증된 세트 간 ±4% 중량 보정 규칙(Table 3 & Table 4)을 적용합니다. 각 세트 종료 직후 사용자가 보고한 RPE가 목표 범위(예: 목표 RPE 6~8, 즉 2~4 RIR)보다 1 RPE 낮을 때마다(가벼울 때마다) 다음 세트 중량을 +4% 증량(RPE 5 보고 시 +4%, RPE 4 보고 시 +8%)하고, 반대로 목표 상한선보다 1 RPE 높을 때마다(무거울 때마다) 다음 세트 중량을 -4% 감량(RPE 9 보고 시 -4%, RPE 10 보고 시 -8%, 또는 바벨 기준 2.5~5 kg 감량)합니다. 만약 과도한 중량으로 인해 목표 횟수를 채우지 못하고 도중에 실패(Missed Reps)했다면, 해당 세트를 즉시 RPE 10(0 RIR)으로 간주하여 기본 감량분(예: 목표 RPE 6~8 기준 -8%)을 적용한 뒤 미달한 반복 횟수 1회당 -4%를 추가로 감량합니다(예: 6회 @ RPE 6~8 목표에서 5회 만에 실패 시 -8%에 -4%를 더해 총 -12% 감량; 6회 @ RPE 7~9 목표에서 5회 실패 시 총 -8% 감량; 6회 @ RPE 5~7 목표에서 5회 실패 시 총 -16% 감량).
주차별 점진적 과부하(Progressive Overload) 단계에서는 더블 프로그레션(Double Progression)과 ACSM 2-for-2 법칙을 결합합니다. 홈트레이닝이나 소근육 운동(예: 덤벨 레터럴 레이즈)에서 8 kg 덤벨을 10 kg으로 바꾸면 단숨에 +25%의 과도한 중량 점프(인클라인 덤벨 프레스 16 kg → 18~18.5 kg 시 +13~16%)가 발생해 자세가 무너집니다. 이때 Plotkin 등(2022, PMC9528903)의 8주 무작위 대조 실험(43명 대상)이 핵심 과학적 근거를 제공합니다. 8주간 횟수를 고정하고 중량을 올린 그룹(LOAD)과 중량을 고정하고 반복 횟수만 늘린 그룹(REPS)을 비교한 결과, 외측광근·가자미근·비복근 등 근육 두께 증가율(6.7~12.9%)과 스미스머신 스쿼트 1RM 증가량(평균 ~20 kg, LOAD 그룹이 +2.0 kg 미세 우세했으나 90% CI -2.4~7.8 kg으로 실용적 차이 없음) 모두 대등했으며, 대퇴직근(Rectus femoris) 두께 합산 성장은 오히려 횟수 증가(REPS) 그룹이 +2.8 mm(90% CI: -0.5~5.8 mm) 더 우세했습니다.
따라서 AI는 사용자에게 먼저 목표 반복 범위(예: 3세트 × 8~12회 @ RIR 2)를 부여하고, 동일한 무게에서 세션마다 반복 횟수를 1~2회씩 늘리도록(8회 → 10회 → 12회) 유도합니다. 이후 모든 세트가 목표 상한선(12회)에 도달하거나 마지막 세트에서 목표보다 1~2회를 초과하여 2회 연속 세션(Two consecutive sessions) 동안 완수(ACSM 2-for-2 Rule, Kraemer & Ratamess, 2004; ACSM, 2009)하면, 다음 세션에서 소근육·상체 운동은 +2~5%(1~2.5 kg), 대근육·하체 운동은 +5~10%(2.5~5 kg) 중량을 올리고 반복 횟수를 다시 하한선(8~9회)으로 리셋합니다. 만약 1년 차 미만 초보자가 2회 연속 세션(숙련자는 3~4회 연속) 동안 횟수나 중량 진전이 없는 정체기(Plateau)를 겪으면 중량을 -10% 감량하여 횟수부터 다시 쌓아 올리며, 1~2주 휴식 후 복귀한 첫 세션은 이전 중량보다 -5~10% 가볍게 자동 세팅하여 부상을 예방합니다(Kassiano et al., 2022).
5. Hands-On Diet (Skybridge MCP) 시스템 통합 및 설득 프로토콜 명세
위 과학적 근거와 수식을 현재 프로젝트(Hands-On Diet — Cloudflare Workers/D1 + Skybridge React 위젯)의 src/inbody-analyzer.ts, recommend-inbody-workout 뷰 도구, 그리고 data-llm 양방향 동기화 구조에 바로 이식할 수 있는 엔지니어링 규격입니다.
5.1 백엔드 1RM 추정 및 자율조절 유틸리티 (src/strength-calculator.ts)
운동 종류(upper_press, lower_compound, deadlift, isolation)와 사용자의 수행 기록(weightKg, reps, rir)을 받아 최적의 1RM과 다음 세트 추천 중량을 반환하는 TypeScript 순수 함수 설계입니다:
export type LiftCategory = "upper_press" | "lower_compound" | "deadlift" | "isolation";export interface SetFeedbackInput {  category: LiftCategory;  weightKg: number;  performedReps: number;  targetRepsMin: number;  targetRepsMax: number;  reportedRir: number; // 0 (RPE 10 실패) ~ 6 (RPE 4 매우 가벼움)  targetRirMin?: number; // 기본값 2 (RPE 8 상한)  targetRirMax?: number; // 기본값 4 (RPE 6 하한)}export interface LoadRecommendation {  estimated1RmKg: number;  formulaUsed: "Mayhew" | "Wathen" | "Brzycki" | "Epley";  nextSetWeightKg: number;  adjustmentPercent: number;  coachingReason: string;}/** * 10회 이하(유효 반복수 기준 최대 12회)에서 종목별 가장 정확한 공식으로 e1RM 산출 */export function estimate1RM(  weightKg: number,  performedReps: number,  rir: number = 0,  category: LiftCategory = "lower_compound"): { e1RmKg: number; formulaUsed: "Mayhew" | "Wathen" | "Brzycki" | "Epley" } {  if (weightKg <= 0 || performedReps <= 0) {    return { e1RmKg: 0, formulaUsed: "Wathen" };  }  const effectiveReps = Math.min(performedReps + Math.max(rir, 0), 15);  if (effectiveReps === 1) {    return { e1RmKg: weightKg, formulaUsed: "Wathen" };  }  // 데드리프트 및 10회 이하 보수적 추정은 Brzycki 적용  if (category === "deadlift" && effectiveReps <= 10) {    const e1Rm = (weightKg * 36) / (37 - effectiveReps);    return { e1RmKg: Math.round(e1Rm * 10) / 10, formulaUsed: "Brzycki" };  }  // 상체 프레스류는 Mayhew et al. (1992) 지수 모델 적용  if (category === "upper_press") {    const pct = 52.2 + 41.9 * Math.exp(-0.055 * effectiveReps);    const e1Rm = (100 * weightKg) / pct;    return { e1RmKg: Math.round(e1Rm * 10) / 10, formulaUsed: "Mayhew" };  }  // 스쿼트·하체 복합 및 일반 종목은 Wathen (1994) 지수 모델 기본 적용  const pct = 48.8 + 53.8 * Math.exp(-0.075 * effectiveReps);  const e1Rm = (100 * weightKg) / pct;  return { e1RmKg: Math.round(e1Rm * 10) / 10, formulaUsed: "Wathen" };}/** * 목표 횟수(targetReps)와 목표 여유 반복수(targetRir)를 수행하[span_59](start_span)[span_59](end_span)기 위한 적정 작업 중량 역산 */export function calculateWorkingWeight(  e1RmKg: number,  targetReps: number,  targetRir: number = 2,  category: LiftCategory = "lower_compound"): number {  const effectiveReps = targetReps + targetRir;  const pct =    category === "upper_press"      ? (52.2 + 41.9 * Math.exp(-0.055 * effectiveReps)) / 100      : (48.8 + 53.8 * Math.exp(-0.075 * effectiveReps)) / 100;  const rawWeight = e1RmKg * pct;  const step = category === "isolation" ? 1 : 2.5;  return Math.max(step, Math.round(rawWeight / step) * step);}/** * 세트 종료 후 RIR/RPE 편차 및 실패 횟수에 따른 다음 세트 중량 ±4% 자동 보정 */export function recommendNextSetLoad(input: SetFeedbackInput): LoadRecommendation {  const targetRirMin = input.targetRirMin ?? 2; // RPE 8  const targetRirMax = input.targetRirMax ?? 4; // RPE 6  const { e1RmKg, formulaUsed } = estimate1RM(    input.weightKg,    input.performedReps,    input.reportedRir,    input.category  );  let adjustmentPercent = 0;  let coachingReason = "목표 강도(RPE 6~8 / 여유 반복 2~4개)에 정확히 부합합니다. 다음 세트도 현재 중량을 유지하세요.";  if (input.performedReps < input.targetRepsMin && input.reportedRir === 0) {    // 목표 최소 횟수 미달 및 실패(RPE 10) 도달 시: 기본 RIR 초과분(-4% * targetRirMin) + 미달 1회당 -4% 추가 감량    const missedReps = input.targetRepsMin - input.performedReps;    adjustmentPercent = -4 * (targetRirMin + missedReps);    coachingReason = `목표 횟수(${input.targetRepsMin}회)에 ${missedReps}회 미달하며 실패 지점(0 RIR)에 도달했습니다. 신경계 피로 방지와 목표 볼륨 완수를 위해 중량을 ${Math.abs(adjustmentPercent)}% 감량합니다.`;  } else if (input.reportedRir < targetRirMin) {    // 횟수는 채웠으나 여유 반복이 목표보다 적을 때 (예: 1 RIR = RPE 9 또는 0 RIR = RPE 10)    const rirDeficit = targetRirMin - input.reportedRir;    adjustmentPercent = -4 * rirDeficit;    coachingReason = `목표보다 한계 지점에 가까웠습니다(${input.reportedRir} RIR). 다음 세트 횟수 급락을 막기 위해 중량을 ${Math.abs(adjustmentPercent)}% 낮춥니다.`;  } else if (input.reportedRir > targetRirMax) {    // 여유 반복이 목표보다 많이 남았을 때 (너무 가벼움)    const rirSurplus = input.reportedRir - targetRirMax;    adjustmentPercent = Math.min(8, 4 * rirSurplus);    coachingReason = `현재 중량에서 여유 반복이 input.reportedRir개이상남았습니다.충분한기계적장력을위해다음세트중량을+{adjustmentPercent}% 올립니다.`;  }  const step = input.category === "isolation" ? 1 : 2.5;  const rawNext = input.weightKg * (1 + adjustmentPercent / 100);  const nextSetWeightKg = Math.max(step, Math.round(rawNext / step) * step);  return {    estimated1RmKg: e1RmKg,    formulaUsed,    nextSetWeightKg,    adjustmentPercent,    coachingReason,  };}
5.2 트레이너 말투(1~5단계)와 결합한 상황별 과학적 설득 스크립트 매트릭스
사용자가 위젯 상단 알약(Pill) 탭에서 추천 타이머 모드를 바꾸려 하거나(persuasionPending: true), 부적절한 무게·횟수로 운동하려 할 때 호스트 LLM이 data-llm 상태를 읽고 출력할 수치·논문 기반 설득 템플릿입니다:
사용자 변경 시도 상황
AI가 참조할 인바디·운동 데이터 (data-llm)
적용할 핵심 과학적 근거
트레이너 말투 1단계 (다정·격려) 예시
트레이너 말투 5단계 (직설·유머 독설) 예시
① 좌우 비대칭(isImbalanced: true)인데 rest_timer 대신 amrap/emom 선택 시도
muscleLowerLeftKg, muscleLowerRightKg, 비대칭률(≥ 5%)
• 시간에 쫓기면 강한 쪽 사지가 부하를 뺏는 보상 작용 심화 • 편측 운동 + 휴식 통제 시 교차 교육(Cross-Education)으로 약한 쪽 근력 +11.9~16.4% 전이
"지금 좌우 하체 근육량이 5% 이상(0.3 kg) 차이 나요! 시간에 쫓기는 AMRAP을 하면 무의식적으로 강한 다리만 써서 불균형이 더 심해져요. 세트별 휴식 타이머로 약한 쪽부터 천천히 맞춰봐요!"
"오른쪽 다리가 왼쪽보다 0.3 kg이나 더 무거운데 지금 시간 제한 걸고 짝짝이로 뛰시겠다는 겁니까? 급하게 하면 강한 다리만 일하고 약한 다리는 구경만 합니다. 얌전히 휴식 타이머 켜고 약한 쪽부터 정확히 드세요!"
② C자형(체지방 과다·근부족)인데 amrap/emom 대신 stopwatch 선택 시도
bodyFatPercent, skeletalMuscleKg, C자형 판독 결과
• Paoli et al. (2012): 짧은 휴식 고강도 인터벌 저항운동(HIRT)은 일반 웨이트 대비 운동 후 22시간 안정시 대사량(REE)을 +23.7%(+363 kcal/일) 증가시킴
"C자형 체형에서 체지방을 빠르게 태우려면 심박수가 떨어지지 않게 인터벌을 유지하는 게 핵심이에요! 스톱워치로 쉬엄쉬엄 하면 운동 후 22시간 동안 칼로리가 더 타는 애프터번 효과(+23.7%)를 놓치게 돼요."
"체지방률이 지금 경고등인데 스톱워치 켜놓고 세트 사이에 스마트폰 보며 5분씩 쉬시려고요? 짧은 휴식 인터벌로 심박수를 붙잡아 놔야 운동 끝나고 자는 동안에도 360 kcal가 더 탑니다. 딱 12분 AMRAP 버팁시다!"
③ 1RM 미측정 초보자가 무리한 고중량(또는 너무 가벼운 중량) 고집 시
performedReps, reportedRir, estimated1RmKg
• Helms et al. (2016) RIR-RPE 조견표 및 ±4% 중량 보정 규칙 • Plotkin et al. (2022): 무리한 증량 없이 횟수 증가(REPS)만으로도 8주간 동등한 근비대(6.7~12.9%) 달성
"방금 세트에서 여유 반복이 0개(RPE 10)여서 자세가 흔들렸어요. 무게를 8%만 낮춰도 근육 성장 효과는 똑같으니 안전하게 횟수를 먼저 채워봐요!"
"자세 다 무너지면서 억지로 1개 드는 건 운동이 아니라 관절 노동입니다! 연구 결과 봐도 무리하게 무게 올리는 거나 정확한 무게로 횟수 1~2개 늘리는 거나 근육 크는 건 똑같습니다. 당장 8% 낮추고 10개 깔끔하게 채우세요!"
5.3 프론트엔드 위젯(inbody-workout.tsx) 내 사용자 유도 UX 흐름
위젯 내에서의 사용자 경험은 세 단계로 매끄럽게 이어집니다.
인바디 해부도 및 우선순위 코스 확인: 위젯 상단 좌측의 react-muscle-highlighter가 인바디 취약 부위(노란색)와 오늘 첫 번째로 배치된 우선순위 타겟 근육(빨간색, 비대칭 시 side: "left" | "right")을 표시하고, 왜 이 순서와 타이머 모드가 배정되었는지 과학적 근거 배지를 노출합니다.
첫 무게 설정 및 1RM 자동 역산 슬라이더: 과거 기록이 있는 종목은 저장된 e1RM에서 오늘 목표 횟수(예: 8회 @ 2 RIR → 약 70% 1RM)에 해당하는 추천 무게(kg)를 자동 세팅하며, 첫 수행 종목은 [🔍 내 적정 무게 찾기] 미니 가이드를 띄워 1세트 수행 후 [한계 도달 (0 RIR)] / [딱 적당함 (2~3 RIR)] / [너무 가벼움 (5+ RIR)] 버튼 중 하나를 선택하게 합니다.
data-llm 실시간 동기화 및 더블 프로그레션 알림: 사용자가 세트를 체크하고 RIR 버튼을 누를 때마다 위젯은 recommendNextSetLoad()를 실행해 다음 세트 중량을 ±4% 단위로 자동 보정하고, <div className="hidden" data-llm={JSON.stringify(syncedWorkoutState)} />를 통해 estimated1[span_103](start_span)[span_103](end_span)RmKg, currentRir, inbodyReasoning을 호스트 LLM에 실시간 전달합니다. 만약 2회 연속 세션에서 목표 상한 횟수보다 1~2회 초과 달성한 기록이 감지되면(save-wo[span_61](start_span)[span_61](end_span)rkout-log), 위젯 상단에 [🎉 ACSM 2-for-2 달성! 오늘부터 중량을 +5%(+2.5 kg) 올리고 하한 횟수부터 다시 시작합니다] 배너를 띄워 과학적인 점진적 과부하를 완성합니다.
이 보고서는 정보 제공만을 목적으로 합니다. 의학적 자문이나 진단을 원하시면 전문가와 상담하세요.