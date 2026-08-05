# AGENTS — 작업 지침 및 할 일

이 repo 에서 작업하는 AI 에이전트용. 계획은 [PLAN.md](PLAN.md), 완료 기록은 [WORK_NOTE.md](WORK_NOTE.md).

## 규칙

- 지시받은 범위만 작업한다. `git commit`/`push` 는 주인님이 명시적으로 시킬 때만.
- 각 마일스톤 완료 시 WORK_NOTE.md 에 날짜·내용 기록.
- 기사 본문은 저장하지 않는다 (제목·요약·링크만).
- 프론트는 빌드 스텝 없는 순수 HTML/CSS/JS 유지 — 프레임워크 도입은 별도 승인 필요.
- UI 는 [PLAN.md](PLAN.md) 의 "UI 구성" 절을 따른다 (좌우 스와이프 페이저, 헤더 ⚙, 위젯 대시보드). 구조 변경은 주인님 승인 필요.
- **설정을 바꾸는 핸들러는 `applySettingChange()` 를 쓴다.** `save()` + `openSettings()` 만 하면 패널 뒤의 대시보드·페이지가 갱신되지 않는다 (2026-08-05 실제 버그).
- 기본 차단 목록(`DEFAULT_BLOCKED`)은 주인님이 지정한 것. 임의로 언론사를 추가·제거하지 말 것.

## TODO (마일스톤 순)

- [x] **M1 수집 파이프라인** (2026-08-05)
  - [x] repo 구조 생성 (`site/`, `scripts/`, `.github/workflows/`)
  - [x] `scripts/fetch-news.mjs`: Google 뉴스 RSS(카테고리별) 수집 → 정규화 → `site/data/news.json` (의존성 0, Node 내장 fetch)
  - [x] 제목 유사도 클러스터링 + 중요도 스코어 계산 (coverage × 최신성 반감기 12h)
  - [x] Actions workflow: 30분 cron + 수동 트리거, Pages 배포까지 (`collect.yml` — push 후 동작 검증 필요)
- [x] **M2 기본 뷰어 + 배포** (2026-08-05)
  - [x] `site/index.html`: 기사 리스트 (모바일 우선)
  - [x] GitHub `jayhouse2001/news_feed` (branch `master`), Pages Source = GitHub Actions
        → https://jayhouse2001.github.io/news_feed/ — iPhone 확인 완료
- [x] **M3 차단 기능** (2026-08-05)
  - [x] 언론사 차단 (기사 ⋯ 액션 시트 + 설정 탭 관리 화면, localStorage)
  - [x] 키워드 차단 (제목 부분일치, 대소문자 무시)
- [x] **M4 정렬** (2026-08-05)
  - [x] 카테고리별 정렬 기준 (최신순/중요도순/언론사 우선) — 카테고리마다 따로 기억
  - [x] 카테고리 on/off + 순서 변경 (설정 탭 △▽)
- [x] **M5 대시보드 (위젯 프레임)** (2026-08-05)
  - [x] 위젯 공통 구조: `WIDGET_TYPES` 레지스트리 + `widgetFrame()`, ⋯ 메뉴로 위로/아래로/삭제, ＋위젯 추가
  - [x] 중요 뉴스 위젯: 활성 카테고리 교차 스코어 상위 N 건(3/5/10 선택), 카테고리 배지, 유사기사 중복 제거(0.6)
  - [x] 바로가기 링크 위젯: 링크 추가/삭제/편집/순서변경 패널, URL scheme 그대로 href
- [x] **M6 날씨·미세먼지 위젯** (2026-08-05)
  - [x] 날씨: Open-Meteo forecast — 현재 기온·상태 + **7일 예보**(요일별 아이콘·최고/최저)
  - [x] 미세먼지: Open-Meteo air-quality (PM2.5 등급 칩 + PM10), 날씨와 한 위젯
  - [x] 위치: **geolocation 자동 취득**(8초 타임아웃) → 실패 시 저장된 위치 → 서울
- [x] **M7 PWA** (2026-08-05)
  - [x] manifest.json (standalone), icons(apple-touch 180 / 192 / 512 / maskable), iOS 메타 태그
- [x] **M8 확장** (2026-08-05)
  - [x] 해외 뉴스 8개 카테고리(US edition) + **제목 한국어 번역** (gtx, 키 불필요, localStorage 캐시, 실패 시 원문 + EN 배지)
  - [x] 언론사 차단 UI: 점선 칩 + 탭하면 취소선, 계열 묶음 차단/해제, 기본 차단 19곳(주인님 지정)
  - [x] 기사 열기 방식 선택: 현재 창 / 새 창 / 앱 안에서 읽기
- [ ] **남은 후보 (착수 전 주인님 확인)**
  - [ ] reader 모드 개선: Google 링크는 iframe 시도 없이 바로 Safari 로 (Google 이 프레임 삽입 거부 — 실측 확인됨)
  - [ ] 개별 언론사 RSS 소스 추가 (Actions 러너에서 접근 검증 필요)
  - [ ] 추가 위젯: 환율(Frankfurter ✅검증) / 관심 키워드 뉴스 / 나중에 읽기

## 확인된 사실 (재검증 불필요)

- Google 뉴스 RSS: `https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko` (전체), 카테고리는 `https://news.google.com/rss/headlines/section/topic/<TOPIC>?hl=ko&gl=KR&ceid=KR:ko` (TOPIC: WORLD/NATION/BUSINESS/TECHNOLOGY/SCIENCE/ENTERTAINMENT/SPORTS/HEALTH). 항목에 `<source>` 태그로 언론사명+도메인 포함.
- TECHNOLOGY 와 SCIENCE 는 별개 피드이고 내용도 실제로 다름 (IT=기업·반도체·가상자산, 과학=우주·생명과학·연구). 정치는 topic 피드가 없어 검색 RSS(`정치 when:1d`) 사용.
- Open-Meteo 날씨: 키 불필요·CORS 허용. 예) `https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978&current=temperature_2m,weather_code,precipitation&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia/Seoul`
- Open-Meteo 미세먼지: 키 불필요. 예) `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=37.5665&longitude=126.978&current=pm10,pm2_5&timezone=Asia/Seoul`
- Frankfurter 환율: 키 불필요. 예) `https://api.frankfurter.dev/v1/latest?from=USD&to=KRW,JPY,EUR` (구 도메인 frankfurter.app 는 301 리다이렉트 — .dev 사용)
- 개별 언론사 사이트는 Claude 의 WebFetch 로는 차단됨 — 검증은 Actions 러너(또는 curl)에서 할 것.
- 번역: `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t&q=...` — 키 불필요·CORS 허용. 비공식이라 막힐 수 있으니 실패 시 원문 유지가 필수. 작업 허브 `Z:\work1\work_note\widget_news.js` 가 같은 방식.
- **Google 뉴스 링크는 iframe 삽입 거부** ("news.google.com 연결을 거부했습니다") → 앱 내 reader 모드에서 대부분 안 열림. Safari 폴백 필수.
- 기사 링크는 Google 리다이렉트 URL 이지만 브라우저에서 열면 실제 언론사 본문으로 정상 이동함(실측). HTML 에는 원문 URL 이 없어 서버 측 추출 불가.
- 헤드리스 Edge 캡처는 우측이 잘려 보일 수 있음 — 레이아웃 문제로 오판하지 말고 `scrollWidth`/`clientWidth` 로 판단할 것.

## 검증 방법 (이 프로젝트에서 확립된 패턴)

`index.html` 을 복제해 `</body>` 앞에 진단 스크립트를 삽입한 임시 페이지(`_probe*.html`)를 만들고 헤드리스 Edge 로 캡처해 DOM 상태를 수치로 확인한다. iframe 방식은 링크 클릭이 프레임을 이동시켜 실패하므로 **앱과 같은 문서에서** 실행할 것. 검증 후 임시 파일은 삭제.
