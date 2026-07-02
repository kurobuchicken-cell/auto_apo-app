'use strict';

const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const {
  openDb: openApoDb,
  getDraftsByStatuses,
  countDraftsByStatus,
  countSentLog,
  updateDraftStatus,
} = require('./lib/db');
const { getCompanyById, LEADS_DB_PATH } = require('./m4_draft');
const { addToSuppression } = require('corp-lead-kit');

// 返信・配信停止依頼・バウンスの検知はv1では手動（送信自体が樫山個人の受信箱への手動運用のため）。
// sentの下書きに反応の有無を尋ね、repliedの下書きにアポ獲得（meeting_set）の有無を尋ねる対話式CLI。
async function run() {
  const apoDb = openApoDb();
  const rl = readline.createInterface({ input, output });

  try {
    const drafts = getDraftsByStatuses(apoDb, ['sent', 'replied']);

    if (drafts.length === 0) {
      console.log('反応待ち（sent）・アポ化待ち（replied）の下書きが見つかりませんでした。');
      return { updated: 0, skipped: 0 };
    }

    let updatedCount = 0;
    let skippedCount = 0;

    for (const draft of drafts) {
      const company = getCompanyById(draft.company_id);
      const companyName = company ? company.name : `company_id:${draft.company_id}`;
      console.log(`\n${'='.repeat(40)}`);
      console.log(`draft #${draft.id} ${companyName}（現在: ${draft.status}）`);
      console.log(`件名: ${draft.subject}`);

      if (draft.status === 'sent') {
        const answer = await askChoice(
          rl,
          'この会社から反応がありましたか？ (r=返信 / b=バウンス / u=配信停止依頼 / n=まだ反応なし・スキップ / q=中断): ',
          ['r', 'b', 'u', 'n', 'q']
        );

        if (answer === 'q') {
          console.log('中断しました。残りは次回実行時に表示されます。');
          break;
        } else if (answer === 'n') {
          skippedCount++;
          console.log(`[${draft.id}] スキップしました（sentのまま残ります）。`);
          continue;
        } else if (answer === 'r') {
          updateDraftStatus(apoDb, draft.id, 'replied');
          updatedCount++;
          console.log(`[${draft.id}] replied に更新しました。`);
        } else if (answer === 'b' || answer === 'u') {
          const reason = answer === 'b' ? 'bounced' : 'unsubscribed';
          updateDraftStatus(apoDb, draft.id, reason);
          if (company?.corporate_no || company?.email) {
            addToSuppression({
              corporate_no: company.corporate_no,
              email: company.email,
              reason,
              dbPath: LEADS_DB_PATH,
            });
            console.log(`[${draft.id}] ${reason} に更新し、corp-lead-kitのサプレッションリストに登録しました。`);
          } else {
            console.warn(
              `[${draft.id}] ${reason} に更新しましたが、corp-lead-kit側にcorporate_no/emailが見つからずサプレッションリストへの登録をスキップしました。`
            );
          }
          updatedCount++;
        }
      } else {
        const answer = await askChoice(
          rl,
          'アポ獲得しましたか？ (y=meeting_set / n=まだ・スキップ / q=中断): ',
          ['y', 'n', 'q']
        );

        if (answer === 'q') {
          console.log('中断しました。残りは次回実行時に表示されます。');
          break;
        } else if (answer === 'n') {
          skippedCount++;
          console.log(`[${draft.id}] スキップしました（repliedのまま残ります）。`);
        } else {
          updateDraftStatus(apoDb, draft.id, 'meeting_set');
          updatedCount++;
          console.log(`[${draft.id}] meeting_set に更新しました。`);
        }
      }
    }

    console.log(`\n完了: ${updatedCount}件を更新、${skippedCount}件をスキップしました。`);
    return { updated: updatedCount, skipped: skippedCount };
  } finally {
    rl.close();
    apoDb.close();
  }
}

async function askChoice(rl, prompt, choices) {
  let answer;
  do {
    answer = (await rl.question(prompt)).trim().toLowerCase();
  } while (!choices.includes(answer));
  return answer;
}

// 歩留まり（送信数→返信数→アポ数）を集計して表示する（仕様書§3 M7）。
function report() {
  const apoDb = openApoDb();
  try {
    const sentTotal = countSentLog(apoDb);
    const replied = countDraftsByStatus(apoDb, 'replied');
    const meetingSet = countDraftsByStatus(apoDb, 'meeting_set');
    const bounced = countDraftsByStatus(apoDb, 'bounced');
    const unsubscribed = countDraftsByStatus(apoDb, 'unsubscribed');
    const repliedTotal = replied + meetingSet;

    const replyRate = sentTotal > 0 ? ((repliedTotal / sentTotal) * 100).toFixed(1) : '0.0';
    const meetingRate = sentTotal > 0 ? ((meetingSet / sentTotal) * 100).toFixed(1) : '0.0';

    console.log(`送信数: ${sentTotal}`);
    console.log(`返信数（meeting_set含む）: ${repliedTotal}（返信率 ${replyRate}%）`);
    console.log(`アポ獲得数（meeting_set）: ${meetingSet}（アポ化率 ${meetingRate}%）`);
    console.log(`バウンス: ${bounced} / 配信停止依頼: ${unsubscribed}`);

    return { sentTotal, repliedTotal, meetingSet, bounced, unsubscribed };
  } finally {
    apoDb.close();
  }
}

function parseArgs(argv) {
  return { report: argv.includes('--report') };
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args.report) {
    report();
  } else {
    run().catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
  }
}

module.exports = { run, report };
