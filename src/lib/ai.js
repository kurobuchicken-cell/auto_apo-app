'use strict';

const Anthropic = require('@anthropic-ai/sdk');

// 痛み仮説の立案・本文生成は品質が要る処理のため Sonnet を使う（仕様書§7）。
const MODEL = 'claude-sonnet-5';

function createClient(apiKey = process.env.ANTHROPIC_API_KEY) {
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY が設定されていません（M4の稼働には痛み仮説・本文生成用のAPIキーが必須です）');
  }
  return new Anthropic({ apiKey });
}

function extractText(message) {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function fillTemplate(template, vars) {
  return Object.entries(vars).reduce(
    (text, [key, value]) => text.split(`{{${key}}}`).join(value ?? ''),
    template
  );
}

function parseJsonResponse(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`AI応答からJSONを抽出できません: ${text.slice(0, 200)}`);
  return JSON.parse(match[0]);
}

// M5の✏️（要修正）で人間からの修正指示があれば、プロンプトに最優先指示として差し込む。
function buildFeedbackSection(userFeedback) {
  return userFeedback ? `## 人間からの修正指示（最優先で反映すること）\n${userFeedback}\n` : '';
}

// corp-lead-kit側の②（qualifyCompanies）が抽出済みのpain_hintをプロンプトに差し込む。
function buildProcessHintSection(processHint) {
  return processHint ? `- 業務プロセスの手がかり: ${processHint}\n` : '';
}

// prompts/pain_hypothesis.md のプロンプトで痛み仮説を1つ立てる。情報不足なら "LOW_CONFIDENCE" を返す（仕様書§3 M4）。
async function generatePainHypothesis(client, template, { companyName, businessSummary, processHint, userFeedback }) {
  const prompt = fillTemplate(template, {
    company_name: companyName,
    business_summary: businessSummary,
    process_hint_section: buildProcessHintSection(processHint),
    feedback_section: buildFeedbackSection(userFeedback),
  });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });
  return { text: extractText(message).trim(), usage: message.usage };
}

// prompts/mail_body.md のプロンプトで件名・本文をJSON形式で生成する（仕様書§3 M4）。
async function generateMailBody(
  client,
  template,
  { companyName, businessSummary, painHypothesis, senderName, userFeedback }
) {
  const prompt = fillTemplate(template, {
    company_name: companyName,
    business_summary: businessSummary,
    pain_hypothesis: painHypothesis,
    sender_name: senderName,
    feedback_section: buildFeedbackSection(userFeedback),
  });
  // JSON生成が稀に壊れる（不正なエスケープ等）ことがあるため、パース失敗時は1回だけ再試行する。
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = extractText(message);
    try {
      const parsed = parseJsonResponse(text);
      if (typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') {
        throw new Error(`AI応答に subject/body が含まれません: ${text.slice(0, 200)}`);
      }
      return { subject: parsed.subject, body: parsed.body, usage: message.usage };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

module.exports = { createClient, generatePainHypothesis, generateMailBody, MODEL };
