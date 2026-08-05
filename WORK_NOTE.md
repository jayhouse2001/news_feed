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
