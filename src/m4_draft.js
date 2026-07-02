'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const {
  openDb: openApoDb,
  insertDraft,
  getDraftById,
  updateDraftContent,
  getDraftedCompanyIds,
} = require('./lib/db');
const { createClient, generatePainHypothesis, generateMailBody } = require('./lib/ai');
const { createBudgetTracker } = require('./lib/cost');

// corp-lead-kit（別パッケージ）の leads.db を直接参照する。company_id で紐付けるのみで
// corp-lead-kit の公開APIは経由しない（読み取り専用のSELECTのみのため、事実データの
// 参照に留まり§0-1の境界を侵さない）。
const LEADS_DB_PATH =
  process.env.LEADS_DB_PATH || path.join(__dirname, '..', '..', 'corp-lead-kit', 'data', 'leads.db');

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');
const PAIN_HYPOTHESIS_PROMPT = fs.readFileSync(path.join(PROMPTS_DIR, 'pain_hypothesis.md'), 'utf-8');
const MAIL_BODY_PROMPT = fs.readFileSync(path.join(PROMPTS_DIR, 'mail_body.md'), 'utf-8');
const SIGNATURE_TEMPLATE = extractSignatureTemplate(
  fs.readFileSync(path.join(PROMPTS_DIR, 'signature.md'), 'utf-8')
);

// signature.md は説明文＋実テンプレートの構成になっているため、"---" 区切り以降のみを使う。
function extractSignatureTemplate(raw) {
  const parts = raw.split(/\n---\n/);
  return (parts.length > 1 ? parts.slice(1).join('\n---\n') : raw).trim();
}

// 既に下書きがある会社（company_id）はここで除外する。M5の✏️再生成はregenerateDraft経由で
// 既存draft行を上書きするため、このrunからは呼ばれない＝ここで除外しても再生成フローと衝突しない。
function getMailReadyCompanies(limit) {
  const leadsDb = new DatabaseSync(LEADS_DB_PATH, { readOnly: true });
  let alreadyDrafted;
  try {
    const apoDb = openApoDb();
    try {
      alreadyDrafted = new Set(getDraftedCompanyIds(apoDb));
    } finally {
      apoDb.close();
    }
    const rows = leadsDb
      .prepare(`SELECT id, name, business_summary FROM companies WHERE status = 'mail_ready'`)
      .all()
      .filter((c) => !alreadyDrafted.has(c.id));
    return limit ? rows.slice(0, Number(limit)) : rows;
  } finally {
    leadsDb.close();
  }
}

function getCompanyById(id) {
  const db = new DatabaseSync(LEADS_DB_PATH, { readOnly: true });
  try {
    return db
      .prepare(`SELECT id, name, business_summary, email, corporate_no FROM companies WHERE id = ?`)
      .get(id);
  } finally {
    db.close();
  }
}

// 署名の法定4項目（仕様書§4-3）。1つでも欠落していれば送信不可のため下書きを作らない。
function buildSignature() {
  const { SENDER_NAME, SENDER_ADDRESS, SENDER_CONTACT, UNSUBSCRIBE_URL_OR_MAIL } = process.env;
  if (!SENDER_NAME || !SENDER_ADDRESS || !SENDER_CONTACT || !UNSUBSCRIBE_URL_OR_MAIL) {
    return null;
  }
  return SIGNATURE_TEMPLATE.split('{{SENDER_NAME}}')
    .join(SENDER_NAME)
    .split('{{UNSUBSCRIBE_URL_OR_MAIL}}')
    .join(UNSUBSCRIBE_URL_OR_MAIL)
    .split('{{SENDER_ADDRESS}}')
    .join(SENDER_ADDRESS)
    .split('{{SENDER_CONTACT}}')
    .join(SENDER_CONTACT);
}

// 1社分の下書き内容を組み立てる（DB保存は呼び出し側の責務。--dry-run で保存せず確認できるようにするため）。
// userFeedback はM5の✏️（要修正）で人間が入力した修正指示（初回生成時はundefined）。
async function buildDraftForCompany(client, company, signature, budgetTracker, userFeedback) {
  const { name: companyName, business_summary: businessSummary } = company;

  if (!businessSummary) {
    return { confidence: 'low_confidence', subject: null, body: null, pain_hypothesis: null, costJpy: 0 };
  }

  const hypothesisResult = await generatePainHypothesis(client, PAIN_HYPOTHESIS_PROMPT, {
    companyName,
    businessSummary,
    userFeedback,
  });
  const hypothesisCostJpy = budgetTracker.add(hypothesisResult.usage);

  if (hypothesisResult.text.includes('LOW_CONFIDENCE')) {
    return {
      confidence: 'low_confidence',
      subject: null,
      body: null,
      pain_hypothesis: null,
      costJpy: hypothesisCostJpy,
    };
  }

  const mailResult = await generateMailBody(client, MAIL_BODY_PROMPT, {
    companyName,
    businessSummary,
    painHypothesis: hypothesisResult.text,
    senderName: process.env.SENDER_NAME,
    userFeedback,
  });
  const mailCostJpy = budgetTracker.add(mailResult.usage);

  return {
    confidence: 'normal',
    subject: mailResult.subject,
    body: `${mailResult.body}\n\n${signature}`,
    pain_hypothesis: hypothesisResult.text,
    costJpy: hypothesisCostJpy + mailCostJpy,
  };
}

async function run({ limit, dryRun = false } = {}) {
  const signature = buildSignature();
  if (!signature) {
    throw new Error(
      '署名の法定4項目（SENDER_NAME/SENDER_ADDRESS/SENDER_CONTACT/UNSUBSCRIBE_URL_OR_MAIL）が.envに未設定です。下書き生成を中止します（送信不可扱い）。'
    );
  }

  const companies = getMailReadyCompanies(limit);
  if (companies.length === 0) {
    console.log('mail_ready の企業が見つかりませんでした。');
    return { processed: 0, results: [] };
  }

  const client = createClient();
  const apoDb = dryRun ? null : openApoDb();
  const budgetTracker = createBudgetTracker();
  const results = [];

  try {
    for (const company of companies) {
      if (budgetTracker.isOverBudget()) {
        console.warn(
          `DAILY_API_BUDGET_JPY（${budgetTracker.dailyBudgetJpy}円）を超過したため、残りの企業の処理を停止します。`
        );
        break;
      }

      try {
        const draft = await buildDraftForCompany(client, company, signature, budgetTracker);
        if (!dryRun) {
          insertDraft(apoDb, { company_id: company.id, status: 'pending_approval', ...draft });
        }
        results.push({ companyId: company.id, companyName: company.name, ...draft });

        const label =
          draft.confidence === 'low_confidence' ? 'low_confidence（目視判断へ）' : `件名: ${draft.subject}`;
        console.log(`[${company.id}] ${company.name} -> ${label} (¥${Math.round(draft.costJpy)})`);
        if (dryRun && draft.confidence !== 'low_confidence') {
          console.log(`  痛み仮説: ${draft.pain_hypothesis}`);
          console.log(`  本文:\n${draft.body}\n`);
        }
      } catch (err) {
        console.error(`[${company.id}] ${company.name}: エラー - ${err.message}`);
        results.push({ companyId: company.id, companyName: company.name, error: err.message });
      }
    }
  } finally {
    if (apoDb) apoDb.close();
  }

  console.log(`合計コスト: 約¥${Math.round(budgetTracker.spentJpy)}${dryRun ? '（dry-run: DB保存なし）' : ''}`);
  return { processed: results.length, results };
}

// M5の✏️（要修正）から呼ばれる。該当社のみ下書きを再生成し、既存のdraft行を上書きする
// （Discordメッセージ側の後始末はM5の責務のため、ここではDBのcontent/statusのみ更新する）。
async function regenerateDraft(draftId, userFeedback) {
  const signature = buildSignature();
  if (!signature) {
    throw new Error(
      '署名の法定4項目（SENDER_NAME/SENDER_ADDRESS/SENDER_CONTACT/UNSUBSCRIBE_URL_OR_MAIL）が.envに未設定です。再生成を中止します。'
    );
  }

  const apoDb = openApoDb();
  try {
    const existing = getDraftById(apoDb, draftId);
    if (!existing) {
      throw new Error(`draft id=${draftId} が見つかりません。`);
    }
    const company = getCompanyById(existing.company_id);
    if (!company) {
      throw new Error(`company id=${existing.company_id} が見つかりません（corp-lead-kit側）。`);
    }

    const client = createClient();
    const budgetTracker = createBudgetTracker();
    const draft = await buildDraftForCompany(client, company, signature, budgetTracker, userFeedback);

    updateDraftContent(apoDb, draftId, {
      subject: draft.subject,
      body: draft.body,
      pain_hypothesis: draft.pain_hypothesis,
      confidence: draft.confidence,
      status: 'pending_approval',
    });

    return { ...getDraftById(apoDb, draftId), companyName: company.name, costJpy: draft.costJpy };
  } finally {
    apoDb.close();
  }
}

function parseArgs(argv) {
  const args = { limit: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  run(args).catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  run,
  buildDraftForCompany,
  getMailReadyCompanies,
  getCompanyById,
  regenerateDraft,
  LEADS_DB_PATH,
};
