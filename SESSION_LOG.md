# SESSION_LOG

## auto_apo-app-setup-01（2026-07-01）
- やったこと：npm新規プロジェクトのセットアップ。corp-lead-kitをfile:参照でdependenciesに追加し、npm installで解決を確認。仕様書§8のディレクトリ構成に沿った骨組み（src/run.js, src/m4_draft.js〜m7_inbox.js, src/lib/{db,ai,cost}.js）を空ファイルで作成。.gitignore・.env.example（仕様書§9準拠）を整備。GitHubリポジトリ作成・push。続けてユーザー希望により本来別セッション予定だったprompts/3ファイル（pain_hypothesis.md / mail_body.md / signature.md）の中身も同セッションで作成（§3 M4・§4-3法定4項目に準拠、corp-lead-kitのsrc/lib/ai.jsのJSON出力スタイルに合わせた）。
- 完了した状態：`npm install` 済み、`require('corp-lead-kit')` から collectFromCsv / enrichSites / filterCompliant が解決できることを確認済み。GitHubリポジトリ https://github.com/kurobuchicken-cell/auto_apo-app.git にpush済み。prompts/3ファイルは中身あり（テンプレ文面）。src/配下（run.js, m4_draft.js〜m7_inbox.js, lib/*.js）は空ファイルのまま未実装。
- 残課題・次にやること：src/m4_draft.js の実装（prompts/を読み込みAnthropic APIで痛み仮説→本文生成→署名付与→drafts保存）から着手。README.md・CLAUDE.md（運用ルール・§13の判断スイッチ転記）は今回未作成のため、必要になった時点で別セッションで作成する。
- 触ったファイル：package.json, .gitignore, .env.example, src/run.js, src/m4_draft.js, src/m5_discord.js, src/m6_send.js, src/m7_inbox.js, src/lib/db.js, src/lib/ai.js, src/lib/cost.js, prompts/pain_hypothesis.md, prompts/mail_body.md, prompts/signature.md, data/.gitkeep

## auto_apo-app-m4draft-01（2026-07-01）
- やったこと：src/m4_draft.js（M4下書き生成）と src/lib/db.js（draftsテーブル）・src/lib/ai.js（claude-sonnet-5呼び出し）・src/lib/cost.js（コスト集計・予算超過停止）を実装。package.jsonに@anthropic-ai/sdkを追加（corp-lead-kit経由では解決できないため）。.env.exampleにUSD_JPY_RATE・LEADS_DB_PATHを追加。
- 完了した状態：実際にSonnet APIを呼び出し、(1)正常系（痛み仮説→本文JSON→署名付与→drafts保存）、(2)LOW_CONFIDENCE時に下書きを作らず記録、(3)business_summary欠落時はAPI呼び出しなしでlow_confidence、(4)署名の法定4項目が1つでも未設定なら処理開始前に停止、の4パターンを確認済み。本文JSON生成は稀にJSONが壊れて返ることがあったため1回リトライを追加。テスト用に投入したcorp-lead-kit側のダミー企業4件とauto_apo-app側のdata/apo.dbは検証後に削除済み（本番データには残っていない）。GitHubにpush済み（コミット6f44414）。
- 残課題・次にやること：M5（Discord承認）・M6（送信）・M7（返信管理）・src/run.js（オーケストレータ）は未実装。ANTHROPIC_API_KEYは.envに設定済み（キー自体はコミットされていない、.gitignore対象）。
- 触ったファイル：src/m4_draft.js, src/lib/db.js, src/lib/ai.js, src/lib/cost.js, package.json, package-lock.json, .env.example, .env（gitignore対象・未コミット）

## auto_apo-app-discord-01（2026-07-02）
- やったこと：M5（Discord承認）を実装。discord.jsを追加し、src/m5_discord.jsで下書きを1社1メッセージ投稿、✅=GO/❌=NOT GO/✏️=要修正のリアクションで判定する（auto_x-appの承認フローを流用）。途中でユーザーから「✏️のとき修正内容を人間から指示したい」という要望があり、当初の「✏️で無条件にM4再実行」から仕様変更。✏️を押すとチャンネルに修正指示を送るよう促し、次に送られたテキストをprompts/pain_hypothesis.md・prompts/mail_body.mdに追加した{{feedback_section}}経由でAIプロンプトに反映してから再生成する方式にした（ai.js/m4_draft.jsに引き渡し経路を追加）。署名（送信者名・住所等）は.envのSENDER_NAME等から機械的に付与するため、修正指示の対象外（法定表示を偽らないための意図的な制約。実機テストで「送信者名を変えて」という指示が効かなかったのはこの仕様のため、バグではない）。db.jsにdrafts.discord_message_id列（既存DBにも後方互換でALTER TABLE）と取得・status更新・content上書きの関数を追加。
- 完了した状態：src/lib/db.test.jsでdrafts DB更新ロジック（insert/status更新/discord_message_id紐付け/content上書き）の単体テストを実施し全件パス。実際にDiscord Developer PortalでBotを新規作成し（NORTHEPTIONサーバー内にapo-testチャンネルを新設、プライベートチャンネルだったためBotのロールをアクセス許可に追加する必要があった）、corp-lead-kitにテスト用ダミー企業を1件投入 → M4で下書き生成 → M5起動 → Discordへの実投稿 → ✅GOで`approved`への状態遷移 → ✏️要修正+チャンネルでのフィードバック送信→M4再生成+Discordカード更新、までの一連の流れを実機で確認済み。❌NOT GOは実機では未確認だが、GOと対称のDB更新ロジックのため単体テストでカバー。MESSAGE CONTENT INTENTをDeveloper PortalでON化する必要があったため設定済み。テスト用ダミー企業（corp-lead-kit id=5）とテスト用draft（apo.db id=1）は検証後に削除済み。コミット済み（da7e109）。
- 残課題・次にやること：M6（送信・記録）・M7（返信・配信停止管理）・src/run.js（オーケストレータ、--stage制御）が未実装。M5は現状`node --env-file=.env src/m5_discord.js`で単独起動する常駐プロセスとして動く（run.js統合時に呼び出し方を検討）。✏️の修正指示フローは「同時に1件のみ待機」というシンプルな設計（auto_x-appのcurrentPendingPostIdと同じ発想）のため、複数社を同時に✏️した場合は後勝ちになる点は把握しておくこと。
- 触ったファイル：src/m5_discord.js（新規）, src/lib/db.js, src/lib/db.test.js（新規）, src/m4_draft.js, src/lib/ai.js, prompts/pain_hypothesis.md, prompts/mail_body.md, package.json, package-lock.json

## auto_apo-app-send-01（2026-07-02）
- やったこと：M6（送信・記録）をsrc/m6_send.jsに実装。approvedの下書きを1件ずつ（宛先・件名・本文）表示し、「送信しましたか？(y/n/q)」の対話式CLIでy=sent_log記録＋status=sentへ遷移、n=スキップ（approvedのまま次回も表示）、q=中断、という運用にした（手動 or 半自動どちらのマーク方法にするかはユーザーに確認し、1回の実行で通し作業できるCLI対話式を選択）。db.jsにsent_logテーブル（company_id/draft_id/sent_at/channel）とinsertSentLog/getSentLogByDraftIdを追加。m4_draft.jsのgetCompanyByIdにemailを追加（M6の宛先表示用）。ENABLE_AUTO_SEND=trueの場合は警告のみ表示し、半自動送信(SMTP等)自体はv1では未実装のまま手動フローを維持する（仕様書§13-2の判断スイッチはデフォルトOFF）。
- 完了した状態：db.test.jsにsent_logの往復・status=sent遷移の単体テストを追加し全5件パス。実機ではdata/apo.dbにダミーdraft（company_id 997〜999、approved）を投入し、一覧表示・y/n/q・不正入力時の再プロンプト・ENABLE_AUTO_SEND警告表示・DBのstatus/sent_log反映を確認。テストデータは検証後に削除済み（本番データには残っていない）。コミット済み（96acf26）・GitHubにpush済み。
- 残課題・次にやること：M7（返信・配信停止管理）とsrc/run.js（オーケストレータ、--stage制御）が未実装。M6は現状`node src/m6_send.js`で単独起動する対話式CLIとして動く（run.js統合時に呼び出し方を検討）。sent_log.channelは現状デフォルト'email'固定（--channelで上書き可）。
- 触ったファイル：src/m6_send.js（新規実装）, src/lib/db.js, src/lib/db.test.js, src/m4_draft.js

## auto_apo-app-send-01 続き：M7実装（2026-07-02）
- やったこと：同セッション内でユーザーの希望によりM7（返信・配信停止管理）も実装。src/m7_inbox.jsで、sentの下書きに「返信/バウンス/配信停止依頼/まだ反応なし/中断」、repliedの下書きに「アポ獲得(meeting_set)/まだ/中断」を問う対話式CLI（M6と同構成、ユーザーに確認の上で決定）とした。bounced/unsubscribedはcorp-lead-kit（別リポジトリ C:\dev\corp-lead-kit）のサプレッションリストへ登録する必要があったため、db.jsに既にあった`addToSuppressionList`（コメントで「M7で使用予定」と明記済みだったが未公開）をcorp-lead-kit/src/suppression.jsという新規ラッパーで公開APIにし、index.jsからexport（ユーザー承認の上でcorp-lead-kitリポジトリを変更）。`--report`で送信数→返信数→アポ数の歩留まりを集計表示できるようにした。IMAP等での自動受信監視は仕様書§7の技術スタックに記載がなく実受信箱なしにはローカルテストできないため、v1では見送り（手動CLIで統一）。
- ハマったポイント（要注意）：実装当初、m7_inbox.jsからcorp-lead-kitのaddToSuppression呼び出し時にdbPathを渡し忘れており、corp-lead-kit/data/leads.dbではなくauto_apo-appのdata/leads.dbに誤って新規ファイルが作られ、そちらにサプレッションデータが書き込まれてしまっていた（デフォルトのdbPathはprocess.cwd()基準のため、呼び出し元のcwdによって書き込み先が変わる）。動作確認中に「corp-lead-kit側のleads.dbが空のまま」という不整合で発覚。m4_draft.jsのLEADS_DB_PATHをエクスポートし、m7_inbox.js側で明示的にdbPathとして渡すよう修正。誤生成されたauto_apo-app/data/leads.dbは削除済み（本番データではなくテストで作られたものだったため実害なし）。他のモジュールから同様にcorp-lead-kitの公開APIへdbPathを渡す関数を追加する際は、dbPath省略時のデフォルト（cwd基準）に注意すること。
- テスト方法の教訓：`printf "r\nb\nu\n" | node src/xxx.js`のように複数行をパイプで一括投入する検証方法は、Node.jsのreadlineが2問目以降の行を取りこぼす場合があり信頼できない（実際のターミナルでの1行ずつの入力では問題なし）。今後この手のCLIをテストする際は、(1) 実際の対話タイミングを模した遅延付きspawnテスト、または(2) readlineを介さずDB書き込みロジックを直接呼び出すテスト、のどちらかを使うこと。
- 完了した状態：db.test.jsにgetDraftsByStatuses/countDraftsByStatus/countSentLogの単体テストを追加し全6件パス。ダミー企業（corp-lead-kit）・ダミー下書き（apo.db）で bounced/unsubscribed→サプレッションリスト登録、replied→meeting_set、--reportの歩留まり集計を実機確認。テストデータは両DB（apo.db・corp-lead-kitのleads.db）から削除済み。corp-lead-kit側コミット9c1f19c・push済み、auto_apo-app側コミットb2918bb・push済み。
- 残課題・次にやること：src/run.js（オーケストレータ、--stage制御）が未実装。M6・M7とも現状は個別に`node src/m6_send.js` / `node src/m7_inbox.js`で単独起動する対話式CLI。README.md・CLAUDE.md（運用ルール・§13の判断スイッチ転記）も未作成。
- 触ったファイル：src/m7_inbox.js（新規）, src/lib/db.js, src/lib/db.test.js, src/m4_draft.js（auto_apo-app）／ src/suppression.js（新規）, src/index.js（corp-lead-kit、別リポジトリ）

## auto_apo-app-send-01 続き：run.js実装（2026-07-02）
- やったこと：同セッション内でユーザーの希望によりrun.js（オーケストレータ）も実装。`--stage`でall/単体(m1〜m7)/範囲(例: m2-m4)を指定できるCLIにした。ユーザーに確認の上、`--stage all`はM1（母集団取得）〜M4（下書き生成）の自動パイプラインのみを指すことに決定（M5はDiscord Botが常駐する対話フロー、M6・M7も対話式CLIのため、1プロセスで機械的につなげると使い勝手が悪くなるため）。M5/M6/M7はそれぞれ`--stage m5`等で個別起動する運用。M1はCSVファイルパスの指定が必須なため`--file`引数を追加（.envでの固定パス指定ではなくCLI引数方式をユーザーが選択）。M1〜M3でcorp-lead-kitの公開APIを呼ぶ際は、M7実装時に踏んだのと同じ「dbPath省略でauto_apo-app側に誤ってDBが作られる」不具合を再発させないよう、m4_draft.jsのLEADS_DB_PATHを全呼び出しで明示的に渡すようにした。`--stage m2`/`m3`単体実行時（前段の結果を同一プロセス内で持ち越せない場合）向けに、対象status（discovered/enriched）の企業一覧を読み取り専用SELECTで取得するgetCompaniesByStatusを追加。
- 完了した状態：run.test.jsでparseStages（all/単体/範囲/不正値）の単体テストを追加し全4件パス。実機では、国税庁CSV列定義に厳密準拠したダミーCSVでM1実行→処理区分99・法人種別101（国の機関）が正しく除外され1社のみdiscovered登録されることを確認。M2（実スクレイピング・AI）は経由せずenriched状態を直接投入してM3のmail_ready遷移を確認。M4は`--dry-run --limit 1`でCLI経由の実行を確認（low_confidence判定は情報不足のテストデータによる想定内の結果）。M6・M7は空状態での委譲を確認。M5（Discord Bot）は実際のDiscord接続を伴うため今回は起動せず、コードレビューでの確認に留めた。テストデータ（ダミーCSVファイル・corp-lead-kit側のテスト企業）は削除済み。コミット済み（35c1481）・push済み。
- 残課題・次にやること：README.md・CLAUDE.md（運用ルール・§13の判断スイッチ転記）が未作成。M5を`--stage all`の後に実際に通しで動かす検証（Discord実接続を伴うE2E）は未実施。
- 触ったファイル：src/run.js（新規実装）, src/run.test.js（新規）

## auto_apo-app-csv-pilot-01（2026-07-02）
- やったこと：ユーザーが神奈川県全件の法人番号CSV（`C:\dev\corp-lead-kit\data\incoming\14_kanagawa_all_20260630.csv`、約69MB）を用意し、M1で実投入。まず`--limit 1`→全件（373,664社discovered登録）の順で実機確認。続けてコスト試算のため50社→100社の順でM2〜M4パイロットを実施。50社パイロットは`.env`の`ANTHROPIC_API_KEY`読み込み忘れ（`node --env-file=.env`が必要）で一度失敗、フラグ付与で解消。M5（Discord承認）も試験起動し、生成された4件がDiscordに投稿されることを確認（ユーザーは通知確認のみでリアクションでの承認はまだ）。
- ハマったポイント（要注意）：100社パイロットの際、M4の`getMailReadyCompanies`が`status='mail_ready'`の企業を毎回無条件に取得する実装だったため、50社パイロットで既に下書き済みだった4社（company_id 11/37/51/55）が再度ヒットし、同一内容の下書きが2重生成・2重課金される不具合が発覚（draft id 13〜16）。ユーザー承認の上、(1) `db.js`に`getDraftedCompanyIds`を追加し`m4_draft.js`の`getMailReadyCompanies`で下書き済み企業を除外、(2) 重複した draft id 13〜16 をDBから削除、の両方で対応した。M5の✏️再生成（`regenerateDraft`）は既存draft行の上書きでこのフローを通らないため、今回の除外ロジックとは衝突しない。
- コスト計測の教訓：M4は`cost.js`でSonnetの実測コストを出していたが、M2（corp-lead-kit側、Haiku+Web検索）は`usage`を捨てておりコストが一切分からなかった。ユーザーから「usageで正確に確認したい」と要望があり、corp-lead-kit側に`src/lib/cost.js`（Haiku4.5: $1/$5 per Mtok、Web検索: $10/1000回。Anthropic公式pricingページをWebFetchで確認済みの実単価）を新設。`findOfficialWebsite`/`analyzeCompanyPage`は戻り値の形を変えず`onUsage`コールバックでusageを渡す方式にし、既存テスト（フェイク関数注入）との後方互換を保った。`enrichSites`の戻り値配列に`costJpy`プロパティを追加し、`run.js`のM2ログにも合計コストを表示するようにした。
- 完了した状態：実測値が得られた。M2：100社で¥572（約¥5.72/社）。M3通過率（mail_ready）：50社パイロットで4社(8%)、100社パイロットで7社(7%)、合算150社で11社(7.3%)。M4：low_confidence以外は1社あたり約¥2弱。これらの実測値から373,664社全件を実行した場合の概算コストは約220万円（M2が大半を占める）、所要時間はM2の`SCRAPE_DELAY_MS=3000`・`concurrency=1`により約13日間かかる計算（全件を一括で回すのは非現実的、という認識をユーザーと共有）。corp-lead-kit側テスト42件・auto_apo-app側テスト10件、両方全件パスを確認。両リポジトリともコミット・push済み（corp-lead-kit: e38079e、auto_apo-app: b72b84c）。
- 残課題・次にやること：4社（company_id 11/37/51/55、draft id 9〜12）は`pending_approval`のままDiscordに投稿済みだが未承認。100社パイロットで新たに生成された7件（company_id 74/77/115/127/133/134/141、draft id 17〜23）も`pending_approval`のまま。全件実行は「時間的に非現実的」なため、業種・地域等での絞り込みや分割実行の方針を次回検討する必要あり。README.md・CLAUDE.md整備は引き続き未着手。
- 触ったファイル：（auto_apo-app）src/lib/db.js, src/m4_draft.js, src/run.js ／（corp-lead-kit、別リポジトリ）src/lib/ai.js, src/lib/cost.js（新規）, src/m2_enrich.js

## auto_apo-app-csv-pilot-01 続き：コスト内訳分析・文字数最適化（2026-07-02）
- やったこと：ユーザーからAnthropicコンソールの実際の使用額スクリーンショット（2回）を提供してもらい、アプリの自己計算コスト（トークン実測値×公式単価）と実際の請求額の差分を突き合わせて検証した（$3.93 vs $3.89、誤差約1%で一致を確認）。その上で「①M2のコストが高すぎる、現場で使えない」という指摘を受け、cost.jsのcalcCostJpyをトークン代/Web検索代に分離し、平均検索回数も計測できるようにした。30社の診断実行で「Web検索代44%・トークン代56%」という実測内訳を得て、事前の「Web検索が支配的」という仮説を訂正した。
- 実験内容：ユーザーの提案で「同じ対象企業で文字数だけ変えて比較する」ため、過去の100社パイロット（id 62〜156、実際は95社）のCSV由来企業を特定し、本番のleads.dbを直接壊さないようスクラッチパッドにコピーした一時DB上で、analyzeCompanyPageのページ本文トランケート長を12,000字→6,000字→3,000字と変えて3パターン実測比較した。
- 完了した状態：6,000字で¥393/95社（¥4.14/社、12,000字の¥5.72/社から約28%減）、要約品質は27社のbefore/after比較で劣化なしと確認。3,000字はさらに削ったにもかかわらず¥434/95社と逆に上昇（入力トークン削減効果がごくわずかで、出力トークン単価が入力の5倍高いことや検索回数のブレに埋もれるため）。6,000字を採用と判断し、3,000字は不採用でai.jsを6,000字に確定。corp-lead-kit側テスト42件・auto_apo-app側テスト10件、両方全件パスを確認。両リポジトリともコミット・push済み（corp-lead-kit: 3a56b2e、auto_apo-app: 9b898ec）。説明資料_auto_apo-app.htmlに「お金がかかるのはどこ？なぜ？」セクションを新設し、非技術者向けにコスト構造・実測値・全件実行時の概算（約220万円・約13日間）を整理した。
- 残課題・次にやること：説明資料の実測値（1社あたり約5.7円）は12,000字時点の数値のまま。6,000字採用後の新しい実測値（¥4.14/社）への更新は未着手（ユーザーから明示依頼があれば対応）。全件実行時の絞り込み方針（地域・業種等）は引き続き未検討。draft id 9〜12・17〜23はDiscordで`pending_approval`のまま未承認。README.md・CLAUDE.md整備も引き続き未着手。
- 触ったファイル：（corp-lead-kit、別リポジトリ）src/lib/ai.js, src/lib/cost.js, src/m2_enrich.js ／（auto_apo-app）src/run.js, 説明資料_auto_apo-app.html

## auto_apo-app-csv-pilot-01 続き：gBizINFO調査・電話番号/業種追加・M5安定化（2026-07-02〜2026-07-08）
- やったこと：説明資料に「メール下書き1件あたり実質約71円」の解説を追記（M2単価4.1円との混同を防ぐため）。M5のDiscord Botが接続エラー（EHOSTUNREACH、一時的な通信断）で未処理例外によりプロセスごとクラッシュする事象が発生したため、client/shardのerrorイベントハンドラを追加し、ログ出力のみで継続するよう修正（コミット1002d52）。あわせて、M2の生存率7.3%の内訳を実データで分解（website_not_found 67.3%が最大要因）した上で、ユーザー提案の「gBizINFO（経産省・無料の法人情報API）でサイトURLを補完できないか」を検証した。
- gBizINFO検証結果（すべてネガティブ）：(1) website_not_found だった99社でcompany_urlのカバー率を照会 → 0/99（0%）。(2) 未処理のフレッシュな1,000社でも同様に照会 → 9/1000（0.9%）。(3) 業種・資本金・従業員数・設立年・代表者名等の他の属性フィールドも同じ1,000社で確認 → いずれも0.1〜3.0%と同程度に低カバー率。トヨタ自動車のような大企業には`company_url`等が充実している一方、中小企業には基本的にデータが無いことが判明。「10万社処理すれば900件は無料で集まる」という提案についても、全体の獲得件数に対する比率で見ると誤差レベル（37万社処理しても検索コスト削減効果は約0.4%）であり、かつ「将来的に10,000件送りたい」という目標に対してはgBizINFO単独では母数不足（全国500万社を総動員しても計算上8,600件程度で届かない）と試算し、ユーザーと合意の上でURL探索用途としては見送りとした。
- 一方、リストの営業価値向上（テレアポ・DM等への転用）という別角度の要望があり、こちらは実装した：corp-lead-kitのcompaniesテーブルに`phone`（電話番号）・`industry`（業種）列を追加（既存DBへの後方互換ALTER TABLE付き）。電話番号はM2で既に取得済みのページ本文からemail抽出と同じ正規表現方式で追加コストゼロで抽出。業種は新規AI呼び出しを増やさず、既存のanalyzeCompanyPage呼び出しのJSON出力に1項目追加するだけにし、コストへの影響をほぼゼロに抑えた（出力トークンが数十文字増える程度）。住所は既にCSV由来のaddress列に保存済みだったため対応不要だった。
- 完了した状態：corp-lead-kit側テスト44件（scrape.test.jsにextractPhoneNumbersのテスト2件追加）全件パス。実データ20社でM2を実行し、電話番号・業種が正しく取得できることを確認済み（例：ルビーイン株式会社 → phone: 050-5371-8606, industry: 人材紹介・採用支援）。コミット・push済み（corp-lead-kit: 7ecc08e）。gBizINFOのAPIトークンは`corp-lead-kit/.env`のGBIZINFO_API_TOKENに設定済み（`.env.example`には後から気づいて空の雛形に戻した経緯あり、実トークンは一度も`.env.example`側でコミットされていないことを確認済み）。
- 残課題・次にやること：全件実行の絞り込み方針（1,000件狙いなら約7.1万円・約14時間、との試算あり）はまだ実行に移していない。draft id 9〜12・17〜23はDiscordで`pending_approval`のまま未承認。M5 Botはセッション間でプロセスが途切れる（前回セッション終了時に停止する）ため、次回作業開始時は稼働確認・再起動が必要。README.md・CLAUDE.md整備も引き続き未着手。
- 触ったファイル：（corp-lead-kit、別リポジトリ）src/lib/scrape.js, src/lib/db.js, src/lib/ai.js, src/m2_enrich.js, test/scrape.test.js, .env.example ／（auto_apo-app）src/m5_discord.js, 説明資料_auto_apo-app.html

## auto_apo-app-costopt-01：リスト作成/文作成アプリ分離・検索コスト根本原因の発見（2026-07-08〜2026-07-09）
- やったこと：処理済み859社をArtifact化したリード一覧・メール実例集（決裁者向け）を作成し公開。M2の実測コストが859社に増やしたことで¥4.1→¥6.2/社に上振れしたと判明し、説明資料も追随更新（359行目付近参照）。M2実行中に途中経過ログが無く残高不足に気づけなかった反省から、corp-lead-kit側m2_enrich.js/m3b_qualify.jsに50社ごとの進捗＋累計コストログを追加（コミット a7ad71a）。
- **アーキテクチャ再設計（本セッションの中心）**：ユーザーから「corp-lead-kitとauto_apo-appの境界が曖昧」との指摘を受け、「リスト作成アプリ(corp-lead-kit)／文作成アプリ(auto_apo-app)」に役割を再定義。
  - corp-lead-kit：M2を軽量化（AI解析を撤去、メアド抽出は正規表現・フォーム有無はfindContactLinksで無料化）。M3から営業お断り判定への依存を除去。新設`m3b_qualify.js`（qualifyCompanies）が、呼び出し側が選んだ対象（メアドのみ/フォームのみ/両方）だけに①コンプラ判定（軽量3,000字読み・checkOptOut）→②業務内容確認（事業内容・業種・pain_hint、qualifyFromPage）を実行。コミット d9dc250。
  - auto_apo-app：M4は③（メール作成）に専念する形に簡素化、独自の深掘り再取得機能は撤去（corp-lead-kitの②に統合したため）。run.jsに新ステージ`m3b`（対話式で対象選択→qualifyCompanies実行、`--target`で省略可）を追加。コミット cb394d5。
  - pain_hintの精度検証：同一14社で「4項目統合」「①②分離+③3項目」「専用単独呼び出し」を比較したが、ヒット率はいずれも2/14前後で変わらず。実際にページ本文を目視確認したところ、多くの企業サイト（特にBtoC）はナビゲーション/問い合わせフォームのみで業務プロセスの記述が無いことが根本原因と判明（プロンプトや呼び出し方の問題ではない）。null時のみ専用呼び出し(findPainHint)でフォールバックする方式を採用（14社で2→3件に改善、無駄打ちなし）。あわせて、この過程で「以前(sample_drafts作成時)も実はhintがほぼnullだったが、business_summaryだけで十分な品質のメールが生成できていた」ことが判明（hint機能自体の価値は限定的、business_summaryが土台として機能）。
- **重大な発見：M2軽量化はコスト削減になっていなかった**：新設計のM2（検索のみ）を実際に37社・39社の新規会社で計測したところ、**実測¥6.3〜6.5/社**（旧・全部盛りM2の¥6.2/社とほぼ同水準）と判明。原因を1社ずつAPI usageを直接調査して特定：Web検索ツールを持たせるだけなら2,404入力トークン(¥0.44)だが、**実際に検索を1回実行すると検索結果の中身が丸ごと入力トークンとしてカウントされ11,017トークン(約¥3.2)かかる**。M2のコストは「ページ本文を読ませる分析処理」ではなく「Web検索結果を読み込む分」が支配的だったという、これまでの分析の前提が誤りだったことが分かった。以前「トークン代56%・検索代44%」と分解した際、"トークン代"の内訳をfindWebsite側とanalyzeCompanyPage側で切り分けずに「analyzeCompanyPageが主因」と思い込んでいたのが誤認の原因（一度も検証していなかった）。
- **検索コスト削減の代替案を2つ実測比較**：
  1. `max_uses`を3→1に制限：40社実測でコスト¥6.46→¥3.17/社（-51%）、発見率は25.0%（過去実績28〜33%からやや低下、ただし別企業群での比較で確定的ではない）。
  2. AI検索をやめ検索エンジンAPI＋機械選定に置き換え：Google Custom Search JSON APIは2026年新規受付終了・2027年廃止予定、Bing Search APIは2025年8月に廃止済みで、共に新規登録不可と判明。代替としてBrave Search API（$5/1,000回、新規登録可、要クレジットカード）を発見。373,664社全件なら概算**約28万円**（現行の1/9程度）という試算に。ユーザーが実際に登録することで合意し、次セッションで検証予定（本セッション終了時点で未登録・未実装）。
- 完了した状態：corp-lead-kit側テスト51件・auto_apo-app側テスト10件、全件パス。両リポジトリともコミット・push済み（corp-lead-kit最新: d9dc250 → a7ad71a、auto_apo-app最新: 5a66267）。説明資料もアーキテクチャ変更・コスト構造（3段階：①検索¥6.5/社・②お断り判定+内容確認¥0.6/社・③メール作成¥1.5〜2/社、全件試算約248万円）に合わせて更新済み。
- 残課題・次にやること：**Brave Search API未登録**（ユーザーがcorp-lead-kit/.envにBRAVE_SEARCH_API_KEYを設定する必要あり）。登録後、(1)検索結果から公式サイトを機械的に選ぶロジック（モール/SNS/求人媒体等の除外リスト）の実装、(2)実データでのコスト・発見率検証、(3)結果次第でfindOfficialWebsiteの置き換えを実施。max_uses=1案は代替案としてまだ採用も見送りも未確定。draft id 9〜12・17〜23はDiscordで`pending_approval`のまま未承認。M5 Botは前回同様セッション間で停止するため次回稼働確認要。README.md・CLAUDE.md整備は引き続き未着手。
- 触ったファイル：（corp-lead-kit、別リポジトリ）src/index.js, src/lib/ai.js, src/lib/db.js, src/lib/cost.js, src/m2_enrich.js, src/m3_filter.js, src/m3b_qualify.js（新規）, test/ai.test.js, test/m2_enrich.test.js, test/m3_filter.test.js, test/m3b_qualify.test.js（新規） ／（auto_apo-app）prompts/pain_hypothesis.md, src/lib/ai.js, src/m4_draft.js, src/run.js, src/run.test.js, 説明資料_auto_apo-app.html

## auto_apo-app-search-api-01：Brave Search APIによる公式サイト検索の実装・検証、採用見送り（2026-07-09）
- やったこと：corp-lead-kit/.envにBRAVE_SEARCH_API_KEYを設定してもらい、`src/lib/braveSearch.js`（Brave Search API呼び出し＋除外ドメインリストによる公式サイト選定ロジック）、`src/lib/cost.js`へのクエリ課金コスト計算追加、ユニットテスト、実データ検証スクリプト`scripts/verify_brave_search.js`を実装。status='discovered'（M2未処理・約37万社）からランダムサンプリングして計10〜35社規模で目視検証を実施。
- **重大な発見：ドメイン除外リスト方式には構造的な限界がある**：
  1. 除外ドメイン（モール・SNS・求人媒体・法人番号検索サイト等）は当初リストでは不十分で、検証のたびに新しい企業データベース/電話帳サイト（SalesNow、kaishalist.com、grip.website、goo.to法人番号検索、gbiz.go.jp、Mapion電話帳、Yahoo!地図等）が見つかる「いたちごっこ」状態だった。固定リストでの網羅は現実的に困難。
  2. 誤検出対策として検索結果タイトルと社名の表記ゆれ吸収（全角半角・法人格除去）による突き合わせロジック（`looksLikeMatch`）を追加し、読みが似た無関係企業（「株式会社ＴＨＥＲＡ」→無関係の「株式会社テラ」等）の誤採用は防止できた。
  3. しかし、**「企業自身が運営するサイトか、企業について書かれた第三者サイトか」の意味的な区別はドメイン除外・タイトル照合だけでは原理的に防げない**ことが判明。実例：「株式会社ウィザードセンター」で検索すると、地域工業団地組合の会員紹介ページ（k-nakahara-kojo.org/members/...）がタイトルに社名を含むため公式サイトとして誤採用された。AIが行っていた「これは公式サイトか」という意味理解に相当する判断が、機械的ロジックには無い。
  4. 加えて、公式サイト自体を持たない小規模企業（有限会社・合同会社クラス）が一定数存在し、その場合Brave検索はNOT_FOUNDではなく企業に言及した別ページを返す傾向があった。
- コスト自体は非常に安い（¥0.75/社、Brave Search APIはクエリ課金$5/1,000回のみ）ことを確認したが、精度面の課題を共有した結果、ユーザー判断で**採用見送り・現行のAI検索(findOfficialWebsite)を維持**することに決定。今回作成したbraveSearch.js・関連テスト・検証スクリプト・cost.jsの変更は削除し、corp-lead-kitを直前のコミット(d9dc250)の状態に戻した（コミットはしていない）。
- 完了した状態：corp-lead-kitはBrave関連の変更を削除しworking tree clean、既存テスト51件全パスを確認済み。ライブラリ選定の結論（除外リスト方式は精度上の限界があり不採用）は本エントリに記録済みなので、再検討する場合は先に上記4点の限界を踏まえた設計（例：Haikuによる軽量な最終判定を挟むハイブリッド案）から検討すること。
- 残課題・次にやること：検索コスト削減は未解決のまま（現行AI検索¥6.5/社を維持）。max_uses=1案（¥3.17/社、発見率25%）も含め、次に検討する場合はSESSION_LOG.md本エントリとauto_apo-app-costopt-01エントリを両方参照。draft id 9〜12・17〜23はDiscordで`pending_approval`のまま未承認。M5 Bot稼働確認・README.md/CLAUDE.md整備は引き続き未着手。
- 触ったファイル：（corp-lead-kit、削除済み・コミットなし）src/lib/braveSearch.js, test/braveSearch.test.js, scripts/verify_brave_search.js, src/lib/cost.js（変更は取り消し済み）

### 追記：max_uses=1への変更を同一企業ペア比較で検証・採用（同日）
- Brave案を見送った後、代替案として残っていたmax_uses=1（web_searchツールの最大呼び出し回数を3→1に制限）を、同一100社に対しmax_uses=3とmax_uses=1を両方実行するペア比較で検証した（前回セッションの40社テストは別企業群同士の比較で「確定的ではない」との注記があったため、企業群の違いという交絡要因を消す設計にした）。
- 結果（同一100社、scratchpadの一回限りスクリプトで実行・コミットなし）：max_uses=3は発見率25/100(25.0%)・¥6.12/社、max_uses=1は発見率21/100(21.0%)・¥3.29/社。内訳は両方○20社／3のみ○5社／1のみ○1社／両方×74社。発見率の差(4pt)はMcNemar exact検定でp≈0.22となり統計的有意差なし（コインの表裏程度の再現性しかない可能性がある）が、コスト削減(-46%)は前回テスト(-51%)と近い水準で再現性が高いと判断。
- ユーザー判断で**max_uses=1を本番デフォルトに採用**。corp-lead-kit/src/lib/ai.jsのfindOfficialWebsiteに`maxUses`パラメータを追加（デフォルト値を3→1に変更、既存テスト51件は影響なく全パス）。検証根拠はai.js内のコメントにも要点を記載。
- 完了した状態：corp-lead-kit/src/lib/ai.jsのmaxUsesデフォルトが1になり、テスト51件全パス。コミットはまだしていない（要ユーザー確認）。
- 残課題・次にやること：コミット・push未実施。全社（残り約37.3万社）に適用した場合の期待効果は、コスト削減 約106万円・発見数減少（統計的には非有意だが）最大約1.5万社。説明資料のコスト実績（¥6.5/社）はこの変更を反映しておらず更新が必要。
- 触ったファイル：（corp-lead-kit）src/lib/ai.js
