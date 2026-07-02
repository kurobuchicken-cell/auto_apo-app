'use strict';

const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const {
  openDb: openApoDb,
  getDraftsByStatus,
  updateDraftStatus,
  insertSentLog,
} = require('./lib/db');
const { getCompanyById } = require('./m4_draft');

const DEFAULT_CHANNEL = 'email';

// 樫山が自分のメールにコピーしやすい形（宛先・件名・本文）に整形する（仕様書§3 M6：v1は手動送信）。
function formatDraftForSending(company, draft) {
  const to = company?.email || '(メールアドレス不明)';
  return [`宛先: ${to}`, `件名: ${draft.subject}`, '本文:', draft.body].join('\n');
}

// approvedの下書きを1件ずつ表示し、実際に送信したかを対話で確認しながらsent_logへ記録する。
async function run({ limit, channel = DEFAULT_CHANNEL } = {}) {
  if (process.env.ENABLE_AUTO_SEND === 'true') {
    console.warn(
      'ENABLE_AUTO_SEND=true が設定されていますが、半自動送信（SMTP等）はv1では未実装です。手動送信フローで続行します。'
    );
  }

  const apoDb = openApoDb();
  const rl = readline.createInterface({ input, output });

  try {
    let drafts = getDraftsByStatus(apoDb, 'approved');
    if (limit) drafts = drafts.slice(0, limit);

    if (drafts.length === 0) {
      console.log('approved の下書きが見つかりませんでした。');
      return { sent: 0, skipped: 0 };
    }

    let sentCount = 0;
    let skippedCount = 0;

    for (const draft of drafts) {
      const company = getCompanyById(draft.company_id);
      console.log(`\n${'='.repeat(40)}`);
      console.log(`draft #${draft.id}（company_id: ${draft.company_id}）`);
      console.log(formatDraftForSending(company, draft));
      console.log('='.repeat(40));

      let answer;
      do {
        answer = (
          await rl.question('送信しましたか？ (y=送信済みとして記録 / n=スキップ / q=中断): ')
        )
          .trim()
          .toLowerCase();
      } while (!['y', 'n', 'q'].includes(answer));

      if (answer === 'q') {
        console.log('中断しました。残りの下書きは次回実行時に表示されます。');
        break;
      } else if (answer === 'y') {
        insertSentLog(apoDb, { company_id: draft.company_id, draft_id: draft.id, channel });
        updateDraftStatus(apoDb, draft.id, 'sent');
        sentCount++;
        console.log(`[${draft.id}] sent として記録しました。`);
      } else {
        skippedCount++;
        console.log(`[${draft.id}] スキップしました（approvedのまま残ります）。`);
      }
    }

    console.log(`\n完了: ${sentCount}件を記録、${skippedCount}件をスキップしました。`);
    return { sent: sentCount, skipped: skippedCount };
  } finally {
    rl.close();
    apoDb.close();
  }
}

function parseArgs(argv) {
  const args = { limit: null, channel: DEFAULT_CHANNEL };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--channel') args.channel = argv[++i];
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

module.exports = { run, formatDraftForSending };
