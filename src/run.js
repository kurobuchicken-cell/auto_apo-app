'use strict';

const { DatabaseSync } = require('node:sqlite');
const readline = require('node:readline/promises');
const { stdin: rlInput, stdout: rlOutput } = require('node:process');
const { collectFromCsv, enrichSites, filterCompliant, qualifyCompanies } = require('corp-lead-kit');
const m4Draft = require('./m4_draft');
const m5Discord = require('./m5_discord');
const m6Send = require('./m6_send');
const m7Inbox = require('./m7_inbox');

const { LEADS_DB_PATH } = m4Draft;

// m3b：M3で仕分けたmail_ready/call_listのうち対象を選び、コンプラ判定＋業務内容確認を行う段階
// （リスト作成アプリ側の「①②」。対象を絞ることでコストのかかるAI呼び出しの母数を最小化する）。
const STAGE_ORDER = ['m1', 'm2', 'm3', 'm3b', 'm4', 'm5', 'm6', 'm7'];
// --stage all は自動パイプライン（母集団取得〜下書き生成）のみを指す。
// M3bは対象選択の対話プロンプトとAI課金を伴うため、M5（Discord承認）・M6/M7（対話式CLI）と同様に
// 明示的に個別起動する運用とする（仕様書§6でも各段階を個別実行する想定）。
const ALL_STAGES = ['m1', 'm2', 'm3', 'm4'];

function parseStages(stageArg) {
  if (!stageArg) throw new Error('--stage は必須です（例: --stage all, --stage m1, --stage m2-m4）');
  if (stageArg === 'all') return ALL_STAGES;

  const stagePattern = STAGE_ORDER.join('|');
  const rangeMatch = stageArg.match(new RegExp(`^(${stagePattern})-(${stagePattern})$`));
  if (rangeMatch) {
    const start = STAGE_ORDER.indexOf(rangeMatch[1]);
    const end = STAGE_ORDER.indexOf(rangeMatch[2]);
    if (start === -1 || end === -1 || start > end) {
      throw new Error(`--stage の範囲指定が不正です: ${stageArg}`);
    }
    return STAGE_ORDER.slice(start, end + 1);
  }

  if (STAGE_ORDER.includes(stageArg)) return [stageArg];

  throw new Error(`--stage の値が不正です: ${stageArg}（例: all, m1, m2-m4, m3b, m5）`);
}

// corp-lead-kitの各M関数は「読み取り専用のSELECTのみ」の境界内でしか直接db参照を許さない
// （m4_draft.jsのgetCompanyById等と同じ考え方）。前段の実行結果を同一プロセス内で持ち越せない
// 場合（例：--stage m2 のみ単独実行）向けに、対象statusの企業一覧をここで読み出す。
function getCompaniesByStatus(status, limit) {
  const db = new DatabaseSync(LEADS_DB_PATH, { readOnly: true });
  try {
    const stmt = db.prepare(`SELECT * FROM companies WHERE status = ? LIMIT ?`);
    return stmt.all(status, limit ? Number(limit) : -1);
  } finally {
    db.close();
  }
}

async function runM1(options, companies) {
  if (!options.file) {
    throw new Error('--stage に m1 を含む場合は --file が必須です（例: --file data/incoming/xxx.csv）');
  }
  const result = await collectFromCsv({
    file: options.file,
    pref: options.pref,
    limit: options.limit,
    dbPath: LEADS_DB_PATH,
  });
  console.log(`[M1] ${result.length}社を取得しました。`);
  return result;
}

async function runM2(options, companies) {
  const targets = companies || getCompaniesByStatus('discovered', options.limit);
  const result = await enrichSites(targets, { dbPath: LEADS_DB_PATH });
  const { tokenJpy, searchJpy, searchCount, callCount } = result.costBreakdown;
  console.log(`[M2] ${result.length}社を巡回しました。合計コスト: 約¥${Math.round(result.costJpy)}`);
  console.log(
    `  内訳: トークン代 約¥${Math.round(tokenJpy)} / Web検索代 約¥${Math.round(searchJpy)}` +
      `（検索${searchCount}回・API呼び出し${callCount}回、1社あたり平均${(searchCount / result.length).toFixed(2)}回検索）`
  );
  return result;
}

async function runM3(options, companies) {
  const targets = companies || getCompaniesByStatus('enriched', options.limit);
  const result = filterCompliant(targets, { dbPath: LEADS_DB_PATH });
  const mailReady = result.filter((c) => c.status === 'mail_ready').length;
  console.log(`[M3] mail_ready: ${mailReady}社 / call_list・excluded: ${result.length - mailReady}社`);
  return result;
}

// メアドあり(mail_ready)/フォームのみ(call_list)のどちらを対象にAI課金（コンプラ判定＋業務内容確認）
// を行うか、実行のたびに対話で確認する（コストの母数を無自覚に広げないため）。--target で省略可。
async function promptTarget() {
  const rl = readline.createInterface({ input: rlInput, output: rlOutput });
  try {
    let answer;
    do {
      answer = (
        await rl.question(
          '実行対象を選んでください:\n' +
            '1) メアドありの企業のみ（デフォルト）\n' +
            '2) フォームのみ（メアド無し）の企業のみ\n' +
            '3) 両方\n> '
        )
      ).trim();
      if (answer === '') answer = '1';
    } while (!['1', '2', '3'].includes(answer));
    return { 1: 'email', 2: 'form', 3: 'both' }[answer];
  } finally {
    rl.close();
  }
}

async function runM3b(options) {
  const target = options.target || (await promptTarget());
  const statuses = { email: ['mail_ready'], form: ['call_list'], both: ['mail_ready', 'call_list'] }[target];
  if (!statuses) {
    throw new Error(`--target の値が不正です: ${options.target}（email, form, both のいずれか）`);
  }

  const db = new DatabaseSync(LEADS_DB_PATH, { readOnly: true });
  let targets;
  try {
    const placeholders = statuses.map(() => '?').join(', ');
    const stmt = db.prepare(`SELECT * FROM companies WHERE status IN (${placeholders}) LIMIT ?`);
    targets = stmt.all(...statuses, options.limit ? Number(options.limit) : -1);
  } finally {
    db.close();
  }

  const result = await qualifyCompanies(targets, { dbPath: LEADS_DB_PATH });
  const qualified = result.filter((c) => c.status === 'qualified').length;
  console.log(
    `[M3b] 対象: ${target}（${targets.length}社） → qualified: ${qualified}社・合計コスト: 約¥${Math.round(result.costJpy)}`
  );
  return result;
}

async function runM4(options) {
  await m4Draft.run({ limit: options.limit, dryRun: options.dryRun });
}

function runM5() {
  console.log('[M5] Discord承認Botを起動します（常駐プロセス）。');
  m5Discord.start();
}

async function runM6(options) {
  await m6Send.run({ limit: options.limit });
}

async function runM7() {
  await m7Inbox.run();
}

async function run(options) {
  const stages = parseStages(options.stage);
  let companies;

  for (const stage of stages) {
    if (stage === 'm1') companies = await runM1(options, companies);
    else if (stage === 'm2') companies = await runM2(options, companies);
    else if (stage === 'm3') companies = await runM3(options, companies);
    else if (stage === 'm3b') companies = await runM3b(options);
    else if (stage === 'm4') await runM4(options);
    else if (stage === 'm5') return runM5(); // 常駐Botのため、以降の段階には進まない
    else if (stage === 'm6') await runM6(options);
    else if (stage === 'm7') await runM7();
  }
}

function parseArgs(argv) {
  const args = { stage: null, file: null, pref: null, limit: null, dryRun: false, target: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--stage') args.stage = argv[++i];
    else if (argv[i] === '--file') args.file = argv[++i];
    else if (argv[i] === '--pref') args.pref = argv[++i];
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--target') args.target = argv[++i];
    else if (argv[i] === '--industry') {
      i += 1;
      console.warn(
        '--industry はv1では未対応です（gBizINFO利用時のみの想定。USE_GBIZINFO_AS_LIST_SOURCEはデフォルトOFF）。無視します。'
      );
    }
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

module.exports = { run, parseStages, getCompaniesByStatus };
