# Polling型change detection

外部APIを定期的に読み、新しく起きた事象を既読状態（seen set / cursor）で判定して、通知・自動調査などのside effectを起こすworkflowをdesign/reviewするときに使います。outbound-only接続などでwebhookを受けられない構成では、pollingは妥当な選択です。reviewではpollingの有無より、既読状態とside effectの順序を先に確認します。

## Review観点

1. **既読化とside effectの順序**: side effectの完了前に既読を永続化すると、at-most-onceになります。その結果、通知APIの失敗や処理待ち中のprocess再起動で、事象が通知されないまま消えます。既読化はside effectの成功後に行うか、`pending → notified → done` のような段階状態を永続化してください。起動時には未完了分を回収（再実行または中断表示）します。障害通知のように欠落が重複より重い用途ではat-least-onceを選び、受け手側でdedupeします。
2. **初回baselineの永続化**: 「初回起動時は既存事象を既読化するだけで通知しない」設計では、検知0件でも状態fileを作成してください。0件のときに書かない実装では、再起動のたびに初回扱いへ戻り、停止中に起きた事象が黙って既読化されます。読み込み失敗は、file不在（ENOENT）と破損・権限errorを区別し、後者を初回扱いにしないでください。状態fileはtemp fileへ書いてからrenameし、原子的に更新します。
3. **dedupe keyと再実行の単位**: sourceが再実行時に同じIDを再利用する場合（例: CI runのre-run attempt）、IDだけを既読keyにすると再実行後の失敗を検知できません。再実行を別事象として扱う場合は、attempt番号などをkeyに含めます。
4. **検知窓のtimestamp**: APIで作成時刻しか絞り込めない場合、作成から長時間後に状態が変わる事象（承認待ち、後日の再実行）は窓から外れます。窓を広げてclient側で更新時刻・開始時刻により絞るか、このgapを仕様として明記してください。
5. **対象外と判定した事象の再評価**: 対象外の事象を既読にしない設計では、窓内に残る間、pollのたびに詳細APIを呼び直します。実測した件数でcostを見積もり、必要ならIDとattemptの単位で判定結果をcacheします。
6. **既存の同種経路との整合**: 同じsystemにevent駆動の経路（chat message起点の自動調査など）がある場合は、polling経路も同じ保証を持つか比較します。比較対象は、再起動時の回収、同じthread/keyへの並行処理を防ぐ処理中lock、失敗時に再試行を許すための既読解除です。
7. **costと頻度の見積もり**: 1回のpollでのAPI呼び出し数 × 頻度を、rate limitと実測した事象頻度と並べて示します。事象が稀なほど呼び出しの大半は空振りになります。ただし重視すべきなのは、1件の取りこぼしが機能全体の失敗になる点です。

## triggerと実行場所の選び方

- pollingの代わりにpush型のtriggerを検討するときは、一次情報のシステムが持つfailure hookやcompletion eventを優先します（CI/CDならrun/jobの結論）。chat通知のような写しをtriggerにするのは、それが唯一のpush経路で、受信側がwebhookを受けられない場合に限ります。その場合は、送信元の確認と投稿形式を契約として固定し、切断中に届いた分を起動時に履歴から回収します。
- 自動調査の価値は、読める情報源で決まります。実際の失敗例で、CIのログに原因が出ているか、「別のログを見よ」としか出ていないかを確認してから、調査の実行場所と権限を決めてください。人が見られるCIログしか読めない調査は、要約以上の情報を足せません。
- 検知対象の判定（どのjobが本番か等）を、中央の一覧でjob名やlabelの文字列から照合する設計は、workflow側の変更でずれ、検知が黙って止まります。判定は、対象を定義している場所（本番jobのfailure hookなど）で明示してください。
- CIがGitHub Actionsの場合、失敗をtriggerにする方法は次の3つです。
  - 同じworkflowの中: 対象jobを `needs` に持つjobに `if: ${{ failure() && needs.<job>.result == 'failure' }}` を付けます。`failure()` は祖先のjobのどれかが失敗してもtrueになるため、対象jobの結果で絞ります。[2][3] 再実行を扱う場合は、attemptなどのdedupe keyと通知方針をtestで固定します。
  - 同じrepoの別workflow:
    - `on: workflow_run`（`types: [completed]`）と `github.event.workflow_run.conclusion == 'failure'` を使います。workflow fileがdefault branchにあるときだけ動き、連鎖は3段までです。[1]
    - eventの結果はrun単位なので、job単位の判定が要る場合はrunのjobs情報を取得します。[8]
    - `workflow_run`側はsecrets/write tokenにアクセスできるため、先行workflowのuntrusted codeやartifactをその権限で実行しないでください。[1]
    - 同一repo内でworkflow runから次のworkflowを起動する場合、repositoryの`GITHUB_TOKEN`で発火したeventは通常新しいrunを作らず、`repository_dispatch`と`workflow_dispatch`が例外です。[4]
  - 別のrepo:
    - 送り先repoの`repository_dispatch` APIを呼ぶか、organization webhook（`workflow_job`）を受信します。[5][7]
    - `repository_dispatch`を処理するworkflow fileはdefault branch上に置いてください。[1]
    - dispatchには送り先repoで認可されたGitHub App tokenまたはPATを使います。fine-grained tokenでは`Contents: write`、classic PATでは`repo` scopeが必要です。[5]
    - credentialには必要最小限のpermissionだけを付けてください。[6]
    - workflow内の`GITHUB_TOKEN`はworkflowを含むrepositoryに限定されるため、別repoへのdispatchには使わず、送り先repoで認可されたcredentialを用意してください。[9]
- 原因調査に必要なログが別のシステム（クラウド側のtask log、deployment event等）にある場合は、それを読める最小権限のidentityを持てる場所で調査を実行します。強い権限を持つ共有botの中でdeny listにより制限するより、job単位の読み取り専用credential（OIDCでassumeするread-only role等）の方が、権限の境界が明確になります。調査対象のログは信頼できない入力として扱い、外部への投稿はLLMではなく後続の決定的なstepで行います。

## Deterministic test

fake sourceと一時状態fileを使い、次をtestで確認します。

- 初回検知が0件 → 再起動 → 停止中に起きた事象が通知される。
- side effectの失敗後、次のpollで再試行される。
- 処理待ちの事象が、再起動後に回収される。
- 同一IDの再実行が、意図したとおり扱われる（別事象として通知する／しない）。
- 検知窓の境界にある事象が、意図したとおり扱われる。

## Sources

[1] https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows — GitHub Docs: Events that trigger workflows
[2] https://docs.github.com/en/actions/reference/workflows-and-actions/expressions — GitHub Docs: Evaluate expressions in workflows and actions
[3] https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax — GitHub Docs: Workflow syntax for GitHub Actions
[4] https://docs.github.com/actions/using-workflows/triggering-a-workflow — GitHub Docs: Triggering a workflow
[5] https://docs.github.com/en/rest/repos/repos — GitHub Docs: Create a repository dispatch event
[6] https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication — GitHub Docs: Use GITHUB_TOKEN for authentication in workflows
[7] https://docs.github.com/en/webhooks/webhook-events-and-payloads — GitHub Docs: Webhook events and payloads — workflow_job
[8] https://docs.github.com/en/rest/actions/workflow-jobs — GitHub Docs: List jobs for a workflow run
[9] https://docs.github.com/en/actions/concepts/security/github_token — GitHub Docs: GITHUB_TOKEN
