# 서버 설정 (Cloudflare)

트래커를 기기별 `localStorage` 에서 서버로 옮기기 위한 설정. **한 번만 하면 된다.**

앱은 서버 없이도 그대로 동작한다 — 로그인하지 않으면 지금까지처럼 이 기기에만 저장된다.

---

## 왜 Cloudflare 인가

트래커는 사람마다 다르고 쓰기가 필요하다. GitHub Actions 는 30분마다 잠깐 켜졌다
꺼지는 것이라 사용자 요청을 받을 수 없어서, 항상 켜져 있는 쪽(Cloudflare)이 DB·로그인을
맡는다. 뉴스 수집도 같은 cron Worker 로 옮겼다 — 수집기가 두 곳으로 갈라져 있을 이유가
없고, 옮기면 GitHub cron 의 지연(무료 계정은 5~15분 밀린다)도 없어진다.

```
GitHub          소스 저장소 + 배포 트리거 (푸시할 때만)
Cloudflare      Pages(앱) + Functions(API) + D1(계정·이슈) + KV(뉴스) + Worker(30분 수집)
Resend          로그인 메일 발송
```

---

## 1. D1 데이터베이스

```bash
npx wrangler d1 create news-feeder
```

출력의 `database_id` 를 복사해 `worker/wrangler.toml` 의 `REPLACE_WITH_D1_ID` 자리에 넣는다.

스키마 적용:

```bash
npx wrangler d1 execute news-feeder --remote --file=migrations/0001_init.sql
```

확인:

```bash
npx wrangler d1 execute news-feeder --remote --command="SELECT name FROM sqlite_master WHERE type='table'"
```

`users`, `login_tokens`, `sessions`, `trackers`, `events`, `excluded_urls` 6개가 나와야 한다.

---

## 2. Pages 에 DB 연결

Cloudflare 대시보드 → **Workers & Pages** → `news-feeder` → **Settings** → **Bindings**

- **D1 database binding** 추가
- Variable name: `DB`  ← 코드가 `env.DB` 로 찾으므로 **이름이 정확해야 한다**
- D1 database: `news-feeder`

Production 과 Preview 양쪽에 넣는다.

---

## 3. 메일 (Resend)

[resend.com](https://resend.com) 가입 → **API Keys** → 키 생성 (`re_...`).

Pages → **Settings** → **Variables and Secrets** 에 추가:

| 이름 | 값 | 종류 |
|---|---|---|
| `RESEND_API_KEY` | `re_...` | **Secret** |
| `MAIL_FROM` | `onboarding@resend.dev` | Text |

`RESEND_API_KEY` 를 넣지 않으면 메일을 보내지 않고 로그인 링크를 **로그에 출력**한다.
개발 중에는 이 상태로도 동작한다.

### 도메인 없이 쓸 때

`onboarding@resend.dev` 는 Resend 가 제공하는 발신 주소로, **가입한 본인 주소로만** 보낼 수 있다.
다른 사람도 로그인하게 하려면 도메인을 붙여야 한다(Resend → Domains → DNS 레코드 3개 등록).
도메인을 붙이면 SPF/DKIM 이 서고 스팸함으로 갈 확률도 크게 줄어든다.

---

## 4. KV (수집한 뉴스 저장소)

뉴스는 통째로 읽고 쓰는 한 덩어리라 D1 이 아니라 KV 에 둔다. 행 단위로 질의할 일이 없다.

```bash
npx wrangler kv namespace create NEWS
```

출력의 `id` 를 `worker/wrangler.toml` 의 `REPLACE_WITH_KV_ID` 에 넣는다.

**Pages 에도 같은 KV 를 연결한다** (`/api/news` 가 읽는다):

Cloudflare 대시보드 → Workers & Pages → `news-feeder` → Settings → Bindings
- **KV namespace binding** 추가
- Variable name: `NEWS`
- KV namespace: 위에서 만든 것

## 5. 수집 Worker

30분마다 **뉴스와 트래커를 모두** 수집하는 Worker. Pages Functions 는 cron 을 걸 수 없어서 분리돼 있다.

2026-08-19 부터 뉴스 수집도 여기서 한다(예전에는 GitHub Actions). 실측 2.5초로 Workers cron 30초 제한에 여유가 있다.

```bash
cd worker
npx wrangler deploy
```

수동 실행용 비밀키:

```bash
npx wrangler secret put CRON_SECRET
```

아무 문자열이나 넣고, 확인할 때 쓴다:

```
https://news-feeder-cron.<계정>.workers.dev/run?key=<CRON_SECRET>

# 한쪽만 돌리기
.../run?key=<KEY>&only=news
.../run?key=<KEY>&only=trackers
```

**첫 배포 후 한 번 실행해 KV 를 채운다.** 그 전까지는 배포에 포함된 `site/data/news.json` 이 대신 응답한다.

키가 틀리면 403. 이게 없으면 아무나 호출해 Google 뉴스 요청 한도를 태울 수 있다.

---

## 6. 확인

```bash
# 로그인 안 된 상태
curl https://news-feeder.pages.dev/api/auth/me
# {"signedIn":false}

# 인증 없이 트래커 접근
curl https://news-feeder.pages.dev/api/trackers
# {"error":"로그인이 필요합니다."}  (401)
```

앱에서 설정 → 로그인 → 메일 주소 입력 → 메일의 링크 클릭.

---

## 비용

| | 무료 한도 | 실제 사용 |
|---|---|---|
| D1 | 5GB, 하루 500만 읽기 | 수 MB, 하루 수천 |
| Workers | 하루 10만 요청 | 하루 ~50 (cron 48회) |
| Pages | 무제한 대역폭 | — |
| Resend | 하루 100통 | 월 10통 남짓 |

몇 명이 쓰는 규모에서는 전부 $0. 한도를 넘겨도 자동 과금이 아니라 제한이 걸린다.

---

## 로컬 실행

```bash
npx wrangler pages dev site --d1=DB=news-feeder
```

`RESEND_API_KEY` 없이 뜨므로 로그인 링크가 콘솔에 찍힌다. 그 주소를 브라우저에 붙여넣으면 로그인된다.

---

## 데이터 구조 메모

- **키워드는 JSON 배열 문자열**로 저장한다(`kw_all`, `kw_any`). 통째로 읽고 쓰지, 키워드로 가로질러 검색할 일이 없어서 조인 테이블을 만들지 않았다.
- **`excluded_urls` 는 두 가지를 담는다.** `dropped`(사용자가 지운 것)와 `capped`(하루 상한에 걸린 것). 둘 다 "다음 수집이 다시 넣지 못하게" 하는 용도라 한 테이블에 있다.
- **중복 판정은 url + 제목 유사도 두 단계다.** `UNIQUE(tracker_id, url)` 이 싼 쪽을 걸러내고, 같은 날 제목 유사도 0.6 이상을 코드가 걸러낸다. 통신사 원문과 일간지 재작성본은 url 이 달라서 앞쪽만으로는 안 걸린다.
- **수동 추가(`is_manual`)는 유사도 검사를 건너뛴다.** 사용자가 그 기사를 직접 골랐으므로 자동 규칙이 뒤집지 않는다.
