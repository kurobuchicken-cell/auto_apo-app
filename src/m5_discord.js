'use strict';

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const {
  openDb: openApoDb,
  getDraftsByStatus,
  getDraftByDiscordMessageId,
  setDraftDiscordMessageId,
  updateDraftStatus,
} = require('./lib/db');
const { getCompanyById, regenerateDraft } = require('./m4_draft');

const POLL_INTERVAL_MS = 60 * 1000;
const DISCORD_MESSAGE_LIMIT = 2000;
// GO/NOT GO判定後に末尾へ追記する分の余白（判定前のメッセージ長を切り詰める際に確保しておく）。
const FOOTER_RESERVE = 100;

const EMOJI_GO = '✅';
const EMOJI_NOT_GO = '❌';
const EMOJI_FIX = '✏️';

// 同じメッセージへの連打で二重処理しないためのガード（プロセス内メモリのみで十分）。
const processingMessageIds = new Set();

// ✏️（要修正）後、次にチャンネルに送られたテキストを修正指示として受け取るための待機状態。
// 樫山1人がその都度1件ずつ判定する運用のため、同時に1件のみ保持する（auto_x-appの currentPendingPostId と同じ発想）。
let pendingFix = null; // { draftId }

function confidenceLabel(confidence) {
  return confidence === 'low_confidence' ? 'low_confidence（情報不足のため下書き未生成）' : 'normal';
}

// Discordの1メッセージ2000文字制限に収める（超過分は本文側を切り詰める）。
// GO/NOT GO判定後にfooterを追記する余地(FOOTER_RESERVE)も差し引いておく。
function buildDraftMessage(companyName, draft) {
  const header = [
    `**${companyName}**（draft #${draft.id}）`,
    `信頼度: ${confidenceLabel(draft.confidence)}`,
    `痛み仮説: ${draft.pain_hypothesis || '(なし)'}`,
    `件名: ${draft.subject || '(なし)'}`,
    '本文:',
  ].join('\n');
  const trailer = '\n✅=GO　❌=NOT GO　✏️=要修正';
  const omittedSuffix = '\n(...省略)';

  const budget =
    DISCORD_MESSAGE_LIMIT - header.length - trailer.length - omittedSuffix.length - FOOTER_RESERVE - 1;
  let body = draft.body || '(なし)';
  if (body.length > budget) {
    body = `${body.slice(0, Math.max(budget, 0))}${omittedSuffix}`;
  }

  return `${header}\n${body}${trailer}`;
}

async function postPendingDrafts(client, apoDb) {
  const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
  const drafts = getDraftsByStatus(apoDb, 'pending_approval').filter((d) => !d.discord_message_id);

  for (const draft of drafts) {
    const company = getCompanyById(draft.company_id);
    const companyName = company ? company.name : `company_id:${draft.company_id}`;

    const message = await channel.send(buildDraftMessage(companyName, draft));
    await message.react(EMOJI_GO);
    await message.react(EMOJI_NOT_GO);
    await message.react(EMOJI_FIX);

    setDraftDiscordMessageId(apoDb, draft.id, message.id);
    console.log(`[${draft.id}] ${companyName} をDiscordに投稿しました（message_id=${message.id}）`);
  }

  return drafts.length;
}

async function handleReaction(reaction, apoDb) {
  const emojiName = reaction.emoji.name;
  if (![EMOJI_GO, EMOJI_NOT_GO, EMOJI_FIX].includes(emojiName)) return;

  const messageId = reaction.message.id;
  if (processingMessageIds.has(messageId)) return;

  const draft = getDraftByDiscordMessageId(apoDb, messageId);
  if (!draft) return;

  processingMessageIds.add(messageId);
  try {
    if (emojiName === EMOJI_GO) {
      updateDraftStatus(apoDb, draft.id, 'approved');
      await reaction.message.edit(`${reaction.message.content}\n\n→ 判定: GO（approved）`);
      console.log(`[${draft.id}] GO -> approved`);
    } else if (emojiName === EMOJI_NOT_GO) {
      updateDraftStatus(apoDb, draft.id, 'rejected');
      await reaction.message.edit(`${reaction.message.content}\n\n→ 判定: NOT GO（rejected）`);
      console.log(`[${draft.id}] NOT GO -> rejected`);
    } else if (emojiName === EMOJI_FIX) {
      pendingFix = { draftId: draft.id };
      await reaction.message.edit(
        `${reaction.message.content}\n\n✏️ 修正内容をこのチャンネルにそのまま送信してください（送信なしで元の内容のまま再生成したい場合は「そのまま」と送信）。`
      );
      console.log(`[${draft.id}] 要修正 -> 修正指示を待機中`);
    }
  } catch (err) {
    console.error(`[${draft.id}] 判定処理でエラー: ${err.message}`);
  } finally {
    processingMessageIds.delete(messageId);
  }
}

// ✏️の後にチャンネルへ送られたテキストを修正指示としてM4に渡し、再生成結果で元メッセージを更新する。
async function handleFeedbackMessage(message, apoDb) {
  if (!pendingFix) return;
  const { draftId } = pendingFix;
  pendingFix = null;

  const userFeedback = message.content.trim();
  await message.react('👀');

  try {
    const updated = await regenerateDraft(draftId, userFeedback === 'そのまま' ? undefined : userFeedback);
    const originalMessage = await message.channel.messages.fetch(updated.discord_message_id);
    await originalMessage.edit(buildDraftMessage(updated.companyName, updated));
    await message.reply(`[${draftId}] ${updated.companyName} の下書きを修正指示を反映して再生成しました。`);
    console.log(`[${draftId}] 要修正 -> 修正指示を反映して再生成完了（¥${Math.round(updated.costJpy)}）`);
  } catch (err) {
    console.error(`[${draftId}] 修正指示の反映でエラー: ${err.message}`);
    await message.reply(`⚠️ 修正の反映でエラーが発生しました: ${err.message}`);
  }
}

function createClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });
}

function start() {
  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CHANNEL_ID) {
    throw new Error('DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID が.envに未設定です。');
  }

  const apoDb = openApoDb();
  const client = createClient();

  client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} が起動しました（M5 Discord承認）`);
    await postPendingDrafts(client, apoDb).catch((err) => console.error('投稿処理でエラー:', err));

    setInterval(() => {
      postPendingDrafts(client, apoDb).catch((err) => console.error('投稿処理でエラー:', err));
    }, POLL_INTERVAL_MS);
  });

  client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    try {
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();
    } catch (err) {
      console.error('リアクション取得でエラー:', err.message);
      return;
    }
    if (reaction.message.channelId !== process.env.DISCORD_CHANNEL_ID) return;
    await handleReaction(reaction, apoDb);
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channelId !== process.env.DISCORD_CHANNEL_ID) return;
    await handleFeedbackMessage(message, apoDb).catch((err) => console.error('修正指示の処理でエラー:', err));
  });

  // 接続エラー（EHOSTUNREACH等の一時的な通信断）でプロセスごと落ちないようにする。
  // discord.js側が内部的に再接続を試みるため、ここではログ出力のみで処理を継続する。
  client.on('error', (err) => console.error('Discordクライアントでエラー:', err.message));
  client.on('shardError', (err) => console.error('Discordシャードでエラー:', err.message));

  client.login(process.env.DISCORD_BOT_TOKEN);
  return client;
}

if (require.main === module) {
  start();
}

module.exports = { start, postPendingDrafts, handleReaction, handleFeedbackMessage, buildDraftMessage };
