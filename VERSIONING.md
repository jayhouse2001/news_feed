# 버전 규칙

`VERSION` 파일 한 줄이 정본이다. `major.minor.revision`.

| 자리 | 올리는 때 | 예 |
|---|---|---|
| **revision** | 일반 수정 | 버그 수정, 피드 추가·제거, 필터 조정, 문구 변경 |
| **minor** | 큰 수정 | 새 기능, 새 카테고리 묶음, 화면 구성 변경 |
| **major** | 전체 구조 개편 | 수집 파이프라인 교체, 저장소 이전, UI 전면 재작성 |

## 올리는 법

1. `VERSION` 을 고친다.
2. `node scripts/sync-version.mjs` — `site/js/version.js` 와 `manifest.json` 에 반영한다.
3. 커밋한다.

`site/js/version.js` 는 생성 파일이므로 직접 고치지 않는다. 설정 화면 맨 아래가 이 값을 읽는다.
