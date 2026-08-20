import { plainHandler, json, readJson, HttpError } from '../_lib/util.js';
import { callAi, extractJson, PROVIDERS } from '../_lib/ai.js';

// Relays one AI call for the browser, which cannot make it itself — all four
// providers reject cross-origin requests from a page.
//
// The key arrives in the request body, is used for that one call, and is gone
// when the Function returns. It is never stored, never written to D1, never
// logged. Nothing here requires an account either: the key is the user's, so
// the tracker features work signed in or not.

const TASKS = {
  // The failure that prompted all of this: a rule matching 미국 collected the
  // national debt and an altcoin roundup into a war timeline. Keywords cannot
  // tell "about this issue" from "contains this word"; this can.
  filter: {
    maxTokens: 2000,
    system: '당신은 뉴스 편집자입니다. 주어진 이슈의 전개에 실제로 해당하는 기사만 고릅니다.'
      + ' 단어가 겹칠 뿐 이슈와 무관한 기사는 제외합니다.'
      + ' 반드시 JSON 배열만 출력하고 다른 말은 하지 마세요.',
    build: ({ issue, keywords, articles }) => [
      `이슈: ${issue}`,
      keywords && keywords.length ? `키워드: ${keywords.join(', ')}` : '',
      '',
      '아래 기사 중 이 이슈의 전개에 해당하는 것만 고르세요.',
      '단어만 겹치고 주제가 다른 기사는 제외합니다.',
      '',
      '출력 형식: 남길 기사의 번호만 담은 JSON 배열. 예: [0, 3, 7]',
      '',
      ...articles.map((a, i) => `${i}. ${a.title}`),
    ].filter(Boolean).join('\n'),
    parse: (text, { articles }) => {
      const idx = extractJson(text);
      if (!Array.isArray(idx)) throw new Error('배열이 아닙니다.');
      const keep = idx
        .map((n) => (typeof n === 'number' ? n : parseInt(n, 10)))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < articles.length);
      return { keep: [...new Set(keep)] };
    },
  },

  // What the tracker was always for: not a pile of articles but the shape of
  // what happened. The timeline is already deduplicated and capped, so this
  // reads a short list, not the whole feed.
  summary: {
    maxTokens: 1500,
    system: '당신은 뉴스 분석가입니다. 시간순 기사 목록을 읽고 사건의 전개를 정리합니다.'
      + ' 기사에 없는 내용을 지어내지 마세요. 한국어로 답하세요.',
    build: ({ issue, events }) => [
      `이슈: ${issue}`,
      '',
      '아래는 이 이슈의 시간순 기사 제목입니다. 읽고 다음을 정리하세요.',
      '',
      '1. 한 줄 요약',
      '2. 전개 과정 — 국면이 바뀐 지점을 3~6개로',
      '3. 현재 상황',
      '',
      '출력 형식(JSON):',
      '{"headline":"한 줄", "phases":[{"date":"YYYY-MM-DD","what":"무슨 일"}], "now":"현재"}',
      '',
      ...events.map((e) => `${e.date} ${e.title}`),
    ].join('\n'),
    parse: (text) => {
      const j = extractJson(text);
      return {
        headline: String(j.headline || ''),
        phases: (Array.isArray(j.phases) ? j.phases : []).slice(0, 8).map((p) => ({
          date: String(p.date || ''),
          what: String(p.what || ''),
        })),
        now: String(j.now || ''),
      };
    },
  },

  // Keyword rules are the part users get wrong, and the scoring only guesses.
  // Given the issue in plain words, a model proposes the rule instead.
  keywords: {
    maxTokens: 600,
    system: '당신은 뉴스 검색 전문가입니다. 이슈를 추적할 검색 키워드를 제안합니다.'
      + ' 반드시 JSON만 출력하세요.',
    build: ({ issue, sample }) => [
      `이슈: ${issue}`,
      sample ? `예시 기사: ${sample}` : '',
      '',
      '이 이슈의 기사를 모으기 위한 키워드를 제안하세요.',
      '- must: 반드시 제목에 있어야 하는 단어 (0~2개, 좁게)',
      '- any: 이 중 하나만 있어도 되는 단어 (2~5개)',
      '- 너무 흔한 단어(미국, 서울, 정부 등)는 무관한 기사를 부르니 피하세요.',
      '',
      '출력: {"must":["…"], "any":["…","…"], "why":"한 줄 설명"}',
    ].filter(Boolean).join('\n'),
    parse: (text) => {
      const j = extractJson(text);
      const words = (v) => (Array.isArray(v) ? v : [])
        .map((w) => String(w).trim()).filter(Boolean).slice(0, 6);
      return { must: words(j.must), any: words(j.any), why: String(j.why || '') };
    },
  },
};

export const onRequestPost = plainHandler(async ({ request }) => {
  const body = await readJson(request);
  const { provider, key, model, task } = body;

  if (!PROVIDERS[provider]) throw new HttpError('알 수 없는 AI 제공자입니다.', 400);
  if (!key || typeof key !== 'string') throw new HttpError('API 키가 필요합니다.', 400);
  const t = TASKS[task];
  if (!t) throw new HttpError(`알 수 없는 작업: ${task}`, 400);

  // A ceiling on what one call can be asked to read, so a runaway request
  // cannot spend the user's quota in a single press.
  if (Array.isArray(body.articles) && body.articles.length > 120) {
    throw new HttpError('한 번에 120건까지만 처리합니다.', 400);
  }
  if (Array.isArray(body.events) && body.events.length > 200) {
    throw new HttpError('한 번에 200건까지만 처리합니다.', 400);
  }

  let text;
  try {
    text = await callAi({
      provider,
      key,
      model,
      system: t.system,
      prompt: t.build(body),
      maxTokens: t.maxTokens,
    });
  } catch (e) {
    if (e.kind === 'auth') throw new HttpError('API 키가 거부됐습니다. 키를 확인해 주세요.', 400);
    if (e.kind === 'quota') throw new HttpError('사용량 한도에 걸렸습니다. 잠시 후 다시 시도하세요.', 429);
    if (e.name === 'TimeoutError') throw new HttpError('AI 응답이 너무 오래 걸립니다.', 504);
    throw new HttpError(`AI 호출 실패: ${e.message}`, 502);
  }

  try {
    return json({ result: t.parse(text, body) });
  } catch (e) {
    // The raw reply goes back so a format the parser missed is visible rather
    // than reported as a generic failure.
    throw new HttpError(`AI 응답을 해석하지 못했습니다: ${e.message}`, 502);
  }
});

// Lets the app render the provider list and model choices without hardcoding
// them, so adding a provider is a change in one file.
export const onRequestGet = plainHandler(async () => json({
  providers: Object.fromEntries(
    Object.entries(PROVIDERS).map(([k, v]) => [k, {
      label: v.label, docs: v.docs, login: v.login, keyHint: v.keyHint,
      models: v.models, defaultModel: v.defaultModel,
    }])
  ),
}));
