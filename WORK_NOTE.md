# WORK NOTE — 뉴스 피드 프로젝트

## 2026-08-05 — 실현 가능성 확인 및 계획 수립

- 요구사항 정리: GitHub public + 웹서비스, iPhone 에서 확인, 카테고리 선택, 언론사/피드 차단, 카테고리별 정렬, 대시보드(중요 뉴스 모음), 날씨.
- 실현 가능성 실측:
  - Google 뉴스 RSS (ko-KR 전체 + TECHNOLOGY topic 피드) 정상 응답 확인 — 항목별 `<source>` 태그 존재 (언론사 차단 가능 근거).
  - Open-Meteo forecast API 정상 응답 확인 (서울, 현재+주간, 키 불필요).
  - 한겨레·매경 개별 RSS 는 이 세션 fetch 제한으로 미검증 → M8 로 이연.
- 아키텍처 결정: GitHub Actions cron 수집 → `news.json` → GitHub Pages 정적 PWA. 서버 없음.
- [PLAN.md](PLAN.md) 작성 (아키텍처·기능 설계·M1~M8 마일스톤·한계), [AGENTS.md](AGENTS.md) 에 TODO 정리.
- 구현은 미착수 (계획 승인 대기).
- 추가 요구 반영: 외국 뉴스 번역(수단 선택 대기), 대시보드를 위젯 방식으로 변경(추가/삭제/순서변경 + 위젯별 설정).
- 추가 API 실측: Open-Meteo Air Quality(미세먼지 PM10/PM2.5) ✅, Frankfurter 환율 ✅ — 둘 다 키 불필요. 주가지수는 무료 공식 API 없어 보류.
- 바로가기 링크 위젯을 초기 위젯에 추가 (링크 추가/삭제/편집, iPhone URL scheme 지원).
- UI 와이어프레임 작성(대시보드/뉴스/바로가기 편집 + 화면 흐름도) → 주인님 승인, PLAN.md 에 확정 반영. https://claude.ai/code/artifact/fb51d19f-a963-451f-b8a3-286f11d0067d

## 2026-08-05 — M1 수집 파이프라인 + M2 기본 뷰어 구현

- **M1 완료**: [scripts/fetch-news.mjs](scripts/fetch-news.mjs) — 의존성 0 (Node 내장 fetch). Google 뉴스 RSS 9개 카테고리(주요/정치/경제/IT·과학/세계/사회/스포츠/연예/건강) 수집 → 제목 토큰 Jaccard 유사도(≥0.5) 클러스터링 → coverage(관련보도 수) × 최신성(반감기 12h) 스코어 → `site/data/news.json`. 로컬 실행 9/9 카테고리 성공 (총 416건).
  - 정치 카테고리만 topic 피드가 없어 검색 RSS(`정치 when:1d`) 사용.
- **M1 완료**: [.github/workflows/collect.yml](.github/workflows/collect.yml) — 30분 cron + push + 수동 트리거 → 수집 → Pages 배포. **push 전이라 실동작 미검증.**
- **M2 코드 완료**: [site/index.html](site/index.html) + css/js — 하단 탭 3개(대시보드·뉴스·설정, 대시보드/설정은 placeholder), 카테고리 칩, 기사 리스트(제목→원문 새 탭, 언론사·상대시간·"n곳 보도" 배지). 로컬 서버(http-server)+Edge headless 390×844 스크린샷으로 렌더링 검증 완료.
- **관찰 (M5 때 개선)**: Google 뉴스 description 의 관련기사 리스트가 최대 5개라 coverage 가 5 로 포화되는 기사가 많음 → 중요도 변별력을 높이려면 카테고리 간 교차 클러스터링 또는 배지 표시 기준 상향 필요.
- 남은 것: GitHub repo 생성·push·Pages 활성화 (주인님 지시 대기) → iPhone 실기 확인.

## 2026-08-05 — M3·M4·M5 구현 (커밋 9cf4e0d)

- **M3 차단**: 기사 ⋯ → 액션 시트에서 언론사 차단 / 키워드 차단. 설정 탭에 차단 목록(칩 + ✕ 해제) + 직접 추가 입력(언론사는 수집 데이터 기반 자동완성 `datalist`).
- **M4 정렬·카테고리**: 뉴스 상단 "정렬: ○○ ▾" → 최신순/중요도순/언론사 우선. 카테고리별로 따로 저장. 설정 탭에서 카테고리 체크박스 on/off + △▽ 순서변경, 선호 언론사 순위 관리.
- **M5 위젯 대시보드**: `WIDGET_TYPES` 레지스트리 + 공통 `widgetFrame()`(⋯ → 위로/아래로/삭제) + ＋위젯 추가. 중요뉴스 위젯(건수 3/5/10, 카테고리 배지) / 바로가기 위젯(전체화면 편집 패널: 추가·편집·삭제·순서변경).
  - 중요도 포화 문제 대응: 카테고리 교차 풀에서 스코어 정렬 후 제목 유사도 0.6 이상 중복 제거, "n곳 보도" 배지는 5 이상만 표시.
- 탭 상태를 `?tab=` / `#hash` 로 지정 가능 (헤드리스 캡처가 `#` 를 별도 타겟으로 오해해 쿼리 방식 추가).
- **검증**: 로컬 서버 + Edge headless 390px 스크린샷 3장(대시보드/뉴스/설정) + DOM 진단 페이지. 진단 결과 `scrollWidth==clientWidth==390`(가로 오버플로 없음), 링크 4/4 렌더, ⋯ 38개·위젯 버튼 visible. **스크린샷에서 우측이 잘려 보이는 것은 Edge headless 캡처 특성이며 실제 레이아웃 문제 아님.**
- 미리보기 아티팩트(M5 반영): https://claude.ai/code/artifact/8ec90382-e44c-4052-8db6-dc41b8fc7e10

## 2026-08-05 — 배포 완료 + M6·M7

- **배포**: GitHub `jayhouse2001/news_feed` (branch `master`). Pages Source = **GitHub Actions** 로 설정 → https://jayhouse2001.github.io/news_feed/ 로 서비스 중, iPhone 확인 완료.
  - 브랜치명은 `main` → `master` 로 변경. 원격 `main` 삭제는 GitHub 기본 브랜치를 master 로 바꾼 뒤에야 가능(그 전엔 `refusing to delete the current branch` 로 거부됨).
  - workflow trigger 도 `master` 로 수정 (안 고치면 push 해도 갱신 안 됨).
  - ⚠️ `index.html` 은 `site/` 안에 그대로 둔다. Pages Source 가 GitHub Actions 이므로 `site/` 가 사이트 루트로 배포됨 — 루트로 옮길 필요 없음(옮기려다 원복함).
- **M6 날씨·미세먼지 위젯**: Open-Meteo forecast + air-quality 를 브라우저에서 직접 호출(키 불필요·CORS 허용). 한 위젯에 기온·날씨·최고/최저 + PM2.5 등급 칩(좋음≤15/보통≤35/나쁨≤75/매우나쁨)·PM10·강수확률. 위젯 헤더 버튼으로 지역 선택(프리셋 7곳 + geolocation). 좌표 키 기준 캐시.
- **M7 PWA**: manifest.json + icons(192/512, maskable 포함) + iOS 메타 태그. 아이콘은 SVG 를 Edge headless 로 PNG 렌더해 생성(SVG 원본은 삭제).
- **검증**: 로컬 서버 + Edge headless. 날씨 위젯 실데이터 렌더 확인(31°, 맑음, PM2.5 17 "보통", 강수 82%), manifest·아이콘 3종 HTTP 200, iOS 메타 태그 4종 존재, 가로 오버플로 없음.

## 2026-08-05 — UI 전면 개편 (좌우 스와이프 페이저)

주인님 지시로 하단 탭 구조 폐기. [PLAN.md](PLAN.md) "UI 구성" 절 개정.

- **페이저**: `body` 를 flex 컬럼 + `overflow:hidden` 으로 고정하고, `.pager` 를 `scroll-snap-type: x mandatory` 로 좌우 스와이프. 페이지 = 대시보드 1개 + 활성 카테고리 N개 (스크롤은 페이지 안에서 세로로).
  - 제목/인디케이터는 `scroll` 이벤트에서 `scrollLeft / clientWidth` 로 현재 인덱스 계산해 동기화(rAF 스로틀).
- **하단 탭바 제거**, 설정은 헤더 오른쪽 ⚙ 아이콘 → 전체화면 패널.
- **헤더 아래 칩 줄**: 페이지 인디케이터 + 탭하면 해당 페이지로 이동.
- **날씨**: `geolocation.getCurrentPosition` 으로 **휴대폰 위치 자동 취득**(8초 타임아웃, 10분 캐시) → 그 좌표의 현재 날씨 + **7일 예보**(요일별 아이콘·최고·최저). 실패 시 저장된 위치 → 서울 폴백. 지역 프리셋 목록은 제거.
- **검증**: DOM 진단 — 탭바 없음 확인, 페이지 11개(대시보드+카테고리 10), pager scrollWidth/clientWidth = 11.0, snap type `x mandatory`, 주간 셀 7개(오늘 목 금 토 일 월 화), 스와이프 후 제목·활성 칩이 "주요"로 전환, 세로/가로 오버플로 없음. 실화면 스크린샷으로 레이아웃 확인.

## 2026-08-05 — 마무리 (해외 번역 · 차단 UI · 열기 방식)

커밋: `173998c` → `2ed0845` → `415627d` → `e06e3cc` → `620ac43` (전부 push 완료)

- **새로고침 버튼**: 제목 오른쪽. `news.json` 재요청 → 페이지 재생성. 로딩 중 SVG 회전 + 중복 클릭 차단, 실패 시 "업데이트 실패" 2초 후 복구.
- **아이콘**: 설정 톱니바퀴를 방사형 선(태양처럼 보였음) → 실제 톱니 6개 형태로 교체. 앱 아이콘은 iOS 용 `apple-touch-icon.png`(180) 추가 — **로컬에만 있고 push 안 되어 홈 화면에서 안 보였던 것**이 원인이었음.
- **기사 열기 방식** (설정 최상단, 3택): 현재 창(뒤로 시 페이지·스크롤 복원) / 새 창 / 앱 안에서 읽기(리더 + "◀ 목록").
  - ⚠️ reader 모드는 Google 뉴스가 iframe 삽입을 거부해 실사용 불가 수준. Safari 폴백 버튼으로 대응 중. 개선안은 AGENTS.md 남은 후보 참조.
- **해외 뉴스 번역**: US edition 8개 카테고리(해외/세계/경제/IT/과학/건강/스포츠/연예, 384건) 수집 + gtx 로 제목 번역. 검증 5/5 성공, 캐시 90건. 국내 기사는 미변경. 작업 허브 `widget_news.js` 와 동일 방식.
- **언론사 차단 UI**: 점선 칩 그리드(탭 → 취소선), 계열 묶음 칩(전체 차단 ↔ 전체 해제, 일부만 차단 시 점선 표시), 개별 해제 가능. 기본 차단 19곳 = 조선·중앙·동아·국민 + 계열사 (**동아사이언스 제외 — 과학 기사 필요**).
- **고친 버그 3개**:
  1. 계열 칩이 렌더 시점 상태를 캡처해, 일부만 차단된 상태에서 누르면 전체 차단이 아니라 전체 해제됨 → 클릭 시점에 상태 재조회.
  2. `defaultBlocksApplied` 플래그를 병합된 객체에서 읽어 마이그레이션이 한 번도 실행되지 않음 → 기존 기기에 기본 차단이 적용 안 됨. 저장된 원본에서 읽도록 수정.
  3. 설정 변경 핸들러가 `openSettings()` 만 호출해 패널 뒤 대시보드·페이지가 갱신되지 않음 → `applySettingChange()` 로 통일.
- **현재 상태**: 19페이지(대시보드 + 카테고리 18), 기사 767건, 위젯 3종. https://jayhouse2001.github.io/news_feed/
- ⚠️ **미배포 — 막힌 지점**: 로컬 커밋 2개(1a4ad65, 9cf4e0d)만 존재.
  - `gh` CLI 미설치. `winget install GitHub.cli` 는 비대화형 세션에서 진행되지 않음(응답 없음, 미설치 확인).
  - Windows 자격증명에 `git:https://github.com` 항목은 존재하나 소유 계정 미확인. `git ls-remote https://github.com/jayhouse/news-feed.git` → "Repository not found" (인증 프롬프트는 없음).
  - `git credential fill` + GitHub API 로 계정·scope 확인 시도는 보안 분류기에 차단됨.
  - ⇒ 배포 재개에는 주인님의 GitHub 계정명 + (gh 설치 또는 토큰 사용) 승인 필요.

## 2026-08-05 — 뉴스 화면 당겨서 새로고침

- 각 뉴스 카테고리 화면이 맨 위일 때 아래로 당겼다 놓으면 `news.json`을 다시 불러오도록 구현.
- 세로 당김이 확정된 경우에만 동작해 기존 좌우 페이지 스와이프와 충돌하지 않으며, 대시보드에는 적용하지 않음.
- 당김 거리와 임계점(놓아서 새로고침), 업데이트 진행 상태를 화면에 표시.
- iOS에서 당김 표시의 높이 변경이 `scrollTop`을 움직여 제스처가 끊길 수 있어, 레이아웃에 영향을 주지 않는 `absolute` + `transform` 방식으로 수정. 로컬 브라우저에서 18개 뉴스 화면의 표시 영역, 초기 스크롤 위치, 비레이아웃 배치를 확인.
