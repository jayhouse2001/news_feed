// One shape over four providers.
//
// The browser cannot call any of these directly — all four reject cross-origin
// requests from a page — so the call goes through a Function. The key travels
// in the request and is used once; nothing is stored, logged, or written to D1.
// That is the whole reason this file exists rather than fetch() in the app.

// Two links per provider, because they answer different questions. The key
// page assumes you are already signed in as the right account; the login page
// is where you go when the site picked up whichever account the browser
// happened to be holding.
// Model IDs are copied from each provider docs page, never inferred — a wrong
// one is invisible until a call fails. Cheapest first in every list: filtering
// headlines is not a reasoning task, and the small models do it for a fraction
// of the price. Checked 2026-08-20.
export const PROVIDERS = {
  claude: {
    label: 'Claude',
    docs: 'https://platform.claude.com/settings/keys',
    login: 'https://platform.claude.com/login',
    keyHint: 'sk-ant-…',
    models: ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'],
    defaultModel: 'claude-haiku-4-5',
  },
  openai: {
    label: 'ChatGPT',
    docs: 'https://platform.openai.com/api-keys',
    login: 'https://auth.openai.com/log-in',
    keyHint: 'sk-…',
    models: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'],
    defaultModel: 'gpt-5.6-luna',
  },
  gemini: {
    label: 'Gemini',
    docs: 'https://aistudio.google.com/apikey',
    login: 'https://accounts.google.com/ServiceLogin?continue=https://aistudio.google.com/apikey',
    keyHint: 'AIza…',
    models: ['gemini-3.5-flash-lite', 'gemini-3.7-flash', 'gemini-3.5-flash'],
    defaultModel: 'gemini-3.5-flash-lite',
  },
  grok: {
    label: 'Grok',
    docs: 'https://console.x.ai/team/default/api-keys',
    login: 'https://accounts.x.ai/sign-in',
    keyHint: 'xai-…',
    models: ['grok-4.3', 'grok-4.5', 'grok-4.6'],
    defaultModel: 'grok-4.3',
  },
};

// Each provider gets a request builder and a reply reader. Three of the four
// speak the OpenAI chat shape; Claude and Gemini each want their own.
const CALLERS = {
  claude: {
    url: () => 'https://api.anthropic.com/v1/messages',
    headers: (key) => ({
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
    body: (model, system, prompt, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
    read: (j) => (j.content || []).filter((b) => b.type === 'text')
      .map((b) => b.text).join(''),
  },

  openai: {
    url: () => 'https://api.openai.com/v1/chat/completions',
    headers: (key) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }),
    body: (model, system, prompt, maxTokens) => ({
      model,
      max_completion_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    }),
    read: (j) => ((j.choices || [])[0] || {}).message?.content || '',
  },

  gemini: {
    // Gemini takes the key in the query string and the system prompt in its own
    // field rather than as a message.
    url: (model, key) => 'https://generativelanguage.googleapis.com/v1beta/models/'
      + `${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (model, system, prompt, maxTokens) => ({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0 },
    }),
    read: (j) => (((j.candidates || [])[0] || {}).content?.parts || [])
      .map((p) => p.text || '').join(''),
  },

  grok: {
    url: () => 'https://api.x.ai/v1/chat/completions',
    headers: (key) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }),
    body: (model, system, prompt, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    }),
    read: (j) => ((j.choices || [])[0] || {}).message?.content || '',
  },
};

// Providers word their failures differently; the reader only needs to know
// whether the key is wrong, the quota is out, or something else broke.
function readError(status, body) {
  const msg = body?.error?.message || body?.error?.error || body?.message
    || (typeof body?.error === 'string' ? body.error : '')
    || `HTTP ${status}`;
  if (status === 401 || status === 403) return { kind: 'auth', msg };
  if (status === 429) return { kind: 'quota', msg };
  return { kind: 'other', msg };
}

export async function callAi({ provider, key, model, system, prompt, maxTokens = 2000 }) {
  const c = CALLERS[provider];
  if (!c) throw new Error(`알 수 없는 제공자: ${provider}`);
  if (!key) throw new Error('API 키가 없습니다.');

  const m = model || PROVIDERS[provider].defaultModel;
  const res = await fetch(c.url(m, key), {
    method: 'POST',
    headers: c.headers(key),
    body: JSON.stringify(c.body(m, system, prompt, maxTokens)),
    signal: AbortSignal.timeout(60000),
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${PROVIDERS[provider].label} 응답을 읽을 수 없습니다 (HTTP ${res.status})`);
  }

  if (!res.ok) {
    const e = readError(res.status, json);
    const err = new Error(e.msg);
    err.kind = e.kind;
    err.status = res.status;
    throw err;
  }

  const out = c.read(json);
  if (!out) throw new Error(`${PROVIDERS[provider].label} 가 빈 응답을 보냈습니다.`);
  return out;
}

// Models answer in prose no matter how firmly the format is specified, so the
// parser looks for JSON inside whatever came back rather than trusting the
// whole reply to be JSON.
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('응답에서 JSON을 찾지 못했습니다.');
  const opener = body[start];
  const closer = opener === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, i + 1));
        } catch (e) {
          throw new Error(`JSON 파싱 실패: ${e.message}`);
        }
      }
    }
  }
  throw new Error('JSON이 끝나지 않았습니다.');
}
