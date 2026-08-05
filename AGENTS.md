# AGENTS — 작업 지침 및 할 일

이 repo 에서 작업하는 AI 에이전트용. 계획은 [PLAN.md](PLAN.md), 완료 기록은 [WORK_NOTE.md](WORK_NOTE.md).

## 규칙

- 지시받은 범위만 작업한다. `git commit`/`push` 는 주인님이 명시적으로 시킬 때만.
- 각 마일스톤 완료 시 WORK_NOTE.md 에 날짜·내용 기록.
- 기사 본문은 저장하지 않는다 (제목·요약·링크만).
- 프론트는 빌드 스텝 없는 순수 HTML/CSS/JS 유지 — 프레임워크 도입은 별도 승인 필요.
- UI 는 [PLAN.md](PLAN.md) 의 "UI 구성 (2026-08-05 확정)" 절을 따른다 (하단 탭 3개, 위젯 스택 대시보드, 액션 시트 차단). 구조 변경은 주인님 승인 필요.

## TODO (마일스톤 순)

- [x] **M1 수집 파이프라인** (2026-08-05)
  - [x] repo 구조 생성 (`site/`, `scripts/`, `.github/workflows/`)
  - [x] `scripts/fetch-news.mjs`: Google 뉴스 RSS(카테고리별) 수집 → 정규화 → `site/data/news.json` (의존성 0, Node 내장 fetch)
  - [x] 제목 유사도 클러스터링 + 중요도 스코어 계산 (coverage × 최신성 반감기 12h)
  - [x] Actions workflow: 30분 cron + 수동 트리거, Pages 배포까지 (`collect.yml` — push 후 동작 검증 필요)
- [ ] **M2 기본 뷰어**
  - [x] `site/index.html`: 카테고리 탭 + 기사 리스트 (모바일 우선) — 로컬 스크린샷 검증 완료
  - [ ] GitHub repo 생성·Pages 활성화 → iPhone Safari 에서 확인 (주인님 지시 대기)
- [ ] **M3 차단 기능**
  - [ ] 언론사 차단 (기사 옆 버튼 + 관리 화면, localStorage)
  - [ ] 키워드 차단
- [ ] **M4 정렬**
  - [ ] 카테고리별 정렬 기준 (최신순/중요도순/언론사 우선순위)
  - [ ] 카테고리 탭 순서 변경
- [ ] **M5 대시보드 (위젯 프레임)**
  - [ ] 위젯 공통 구조: 등록(registry)/렌더/위젯별 설정, 추가·삭제·순서변경 UI (localStorage)
  - [ ] 중요 뉴스 위젯: 스코어 상위 N 건, 포함 카테고리·건수 설정 가능
  - [ ] 바로가기 링크 위젯: 링크(이름+URL) 추가/삭제/편집 UI, iPhone URL scheme 지원 (localStorage)
- [ ] **M6 날씨·미세먼지 위젯**
  - [ ] 날씨: Open-Meteo forecast (현재 + 주간, 기본 서울 + geolocation 옵션)
  - [ ] 미세먼지: Open-Meteo air-quality (PM10/PM2.5 + 등급 표시, 날씨와 위치 설정 공유)
- [ ] **M7 PWA**
  - [ ] manifest.json, 아이콘, iOS 메타 태그
- [ ] **M8 (선택) 확장 — 착수 전 주인님 확인**
  - [ ] 개별 언론사 RSS: Actions 러너에서 한겨레·매경·SBS 등 접근 검증 후 소스 추가
  - [ ] 외국 뉴스 번역: 수단 선택 대기 (Google 비공식 vs DeepL Free)
  - [ ] 추가 위젯: 환율(Frankfurter ✅검증) / 관심 키워드 뉴스 / 외신 헤드라인 / 카테고리 뉴스 / 나중에 읽기

## 확인된 사실 (재검증 불필요)

- Google 뉴스 RSS: `https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko` (전체), 카테고리는 `https://news.google.com/rss/headlines/section/topic/<TOPIC>?hl=ko&gl=KR&ceid=KR:ko` (TOPIC: WORLD/NATION/BUSINESS/TECHNOLOGY/ENTERTAINMENT/SPORTS/SCIENCE/HEALTH). 항목에 `<source>` 태그로 언론사명+도메인 포함.
- Open-Meteo 날씨: 키 불필요·CORS 허용. 예) `https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978&current=temperature_2m,weather_code,precipitation&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia/Seoul`
- Open-Meteo 미세먼지: 키 불필요. 예) `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=37.5665&longitude=126.978&current=pm10,pm2_5&timezone=Asia/Seoul`
- Frankfurter 환율: 키 불필요. 예) `https://api.frankfurter.dev/v1/latest?from=USD&to=KRW,JPY,EUR` (구 도메인 frankfurter.app 는 301 리다이렉트 — .dev 사용)
- 개별 언론사 사이트는 Claude 의 WebFetch 로는 차단됨 — 검증은 Actions 러너(또는 curl)에서 할 것.
