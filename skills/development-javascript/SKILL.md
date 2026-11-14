---
name: development-javascript
description: 'TRIGGER when: creating or editing .ts/.js/.mts/.mjs files, creating Node.js CLI tools, or modifying package.json. Enforces coding style, module conventions, package.json standards, and Node.js CLI tool patterns.'
---

## Lint and Format (must)

- `.ts` / `.js` を変更したら、完了前に対象projectまたはworkspaceのroot(package.jsonのあるdirectory)で次を実行し、formatとlintを流す。npm workspaces monorepoではworkspaceごとに、そのworkspaceに属する変更fileだけを`[files...]`で明示して実行する。repo root直下の変更はworkspace所有fileを除いたroot用file listを明示して、repo rootから別に確認する
- `files...`を省略したcheck.tsはgit root全体の変更fileを集める。workspace rootでの実行はcwd外を除外するが、repo rootから再実行すると確認済みnested workspace fileも含まれ、root設定で再formatされる場合がある。workspaceごとに設定が異なる場合は、rootからの自動検出を避け、各rootにowner単位で分割したfile listを渡す

```bash
node <このskillのdirectory>/scripts/check.ts [files...]
```

- filesを省略するとgitの変更ファイル(未追跡を含む)を対象に、`vp fmt`(書き込み) → `vp lint` の順で実行する。`--check` を付けるとformatを書き込まず確認だけ行う
- projectにlint/format設定(`vite.config.*` の `lint`/`fmt`、oxlint/oxfmt、eslint/prettier/biome/dprintの設定ファイル、またはそれらのpackageへの依存)がある場合はproject設定を優先する。vp以外のtoolの場合はscriptがその旨を表示してskipするので、projectのscriptでlint/formatを実行する
- project設定が無い場合はskillの設定(`lint/oxfmt.json`、`lint/oxlint.json`、`lint/plugin.mjs`)を使う
- code style(引用符、セミコロン、関数定義の形式、arrow functionの書き方、変数化)と、lintで検出できるルール(class、import path、forEach、`process.env`、`describe`、引数parser、`interface`、type assertion、返り値の型、`any`、filterの `is`)は文章で定義せず、skillのlint設定を正とする。対応ruleは `lint/oxlint.json` を参照
- errorはすべて修正する。warn(`js-skill/no-single-use-variable`、`js-skill/no-filter-type-predicate`)は判断を伴うため、該当箇所を見直し、残す場合は理由を説明できる状態にする
- disable commentでerrorを抑制してよいのは、外部ライブラリの型定義が不完全な場合など正当な理由があるときだけとし、理由をコメントに明記する
- projectにvite-plusが無い場合、scriptは `npx -p vite-plus@1 vp` で取得する(`npx vp` はplaceholder packageを実行してしまうので使わない)。sandboxで `~/.npm/_npx` に書けず失敗した場合はsandbox外で再実行する

## Environment Variables

- 環境変数は `config.ts` または `config.js` からのみ読み取る
- 他のモジュールは `config` を import して値を参照する

## Date Handling

- API timestamp validationでは`Date.parse()`が有限値を返すことだけを受け入れ条件にしない。非標準入力はruntime依存で解釈され、`2026-02-30`のような不正なcalendar dateが別の日付へ正規化される場合がある。side effect前に期待するformat、calendar date/time fields（うるう年を含む）、timezoneを検証し、read-backにも同じstrict parserを使う。期待するformatやtimezone規則は既存API契約に合わせ、推測しない
- DBカラムが timezone-naive(`::timestamp`)か timezone-aware(`::timestamptz`)かによって、渡す文字列の形式を変える
  - **timezone-naive(`::timestamp`)**: `new Date(v).toISOString()` によるUTC文字列（`Z` 付き）をそのまま渡さない。`::timestamp` は `Z` を無視して数値部分だけをそのまま格納するため、UTC文字列を渡すとJSTセッションでは時刻が09:00ずれる。プロジェクトで採用している日付ライブラリ（dayjs等）でtimezone情報を含まない明示フォーマット文字列を生成して渡す
  - **timezone-aware(`::timestamptz`)**: 逆に timezone情報を落とした文字列を渡さない。オフセットのない文字列を渡すとDB側がセッションタイムゾーンとして解釈し、絶対時刻がずれて格納される。`new Date(v).toISOString()` のようなtimezone情報を含む文字列(またはoffset付き文字列)を渡す
  - どちらのキャストを使うかは既存コードの慣習に揃え、同一コードベース内で混在させない

## Scripting

- 使い捨てのスクリプトを作成・実行する場合は最新バージョンのNode.jsを利用する
- 一時的な自動化でもPythonやBashでの実装を禁じる

## npm Guidelines

- .npmrcをプロジェクトルートに配置し、必要に応じて以下の設定を記述する
  - `min-release-age=7` を記述してリリース後すぐのバージョンを避ける

```bash
# .npmrc
min-release-age=7
```

Dockerfile内でnpmを利用する場合は、`npm install` の前に `.npmrc` をコピーして設定を反映させる.
また、.npmrcのビルド忘れを防ぐために `min-release-age` だけはDockerfileのnpm installコマンドにも直接渡す.

```dockerfile
RUN npm install --min-release-age=7
```

- `min-release-age-exclude` を使う場合は npm 11.17.0 以降を要求する（同設定が追加されたバージョン）
- `omit-lockfile-registry-resolved=true` と併用する前に、npm/cli#9715 の修正が利用する npm リリースに含まれていることと、`npm ci` の回帰テストを確認する。少なくとも npm 11.19.1 / 12.2.0 では、lockfile から `resolved` が省略されると、除外対象でも `npm ci` が `ETARGET` になることを確認した。修正が未収録ならこの組み合わせを避け、`resolved` を保持する lockfile で確認する
- 脆弱性修正では最初に`npm audit --json`のbaselineと`npm audit fix --dry-run --json`の提案・依存経路を保存する。件数削減だけを目的に`--force`を使わず、major updateは互換性とworkspace全体への影響を検証して採否を判断する
- npm workspacesではroot overridesと各workspaceの直接依存を照合し、rootからlockfileを更新する。変更後は`npm ci --ignore-scripts`、audit、native test/build/typecheck/lintを実行し、baselineとfinalのseverity件数を分けて記録する
- `vp migrate`などの移行toolが途中で失敗しても、manifest/config/lockfileやpackage installが先に変更された可能性がある。rollbackとみなさず、tracked/untracked差分、生成物、migration review項目を確認してから手動で検証する
- `vp dev`やpreviewなどCLI入口を移行する場合はworkspaceごとに動的portでHTTP smokeを行う。previewの失敗は同じ引数・条件でclean baseも確認し、既存問題とregressionを区別する
- lintのtypeCheckを無効にする場合は、独立した`tsc`/workspace typecheck gateがtestまたはCIで確実に実行されることを確認する
- build/test後はtracked/untrackedの生成物を確認し、依存更新と無関係なartifactをcommitへ含めない

## Linked Worktree and npm Workspace Verification

- linked worktreeには`node_modules`が伴わないことがある。npm script、`npx`、wrangler等を実行する前に`node_modules/.bin`または対象binaryの実在を確認する
- 依存が不足している場合は、専用worktreeのrepository rootから、同worktreeにあるroot lockfile/workspacesを使って`npm ci`（必要なら`--ignore-scripts`）等を実行する。root checkoutや別worktreeの`node_modules`をコピー・暗黙参照しない
- root lockfile + workspaces構成では、workspace package directory内で無計画な`npm ci`/`npm install`を実行してnested `node_modules`やlockfileを作らない。package managerの解決経路とlockfileの所在を先に確認する
- build・生成・testにworkspace間の依存順序がある場合は、生成元を先に実行し、並列実行で前提を壊さない

## package.json Guidelines

- はじめてpackage.jsonを作成する場合は下記のみで構成する
  - `private: true` と `type: "module"` のみを記述
  - `name`, `main`, `version`, `author`, `license`, `description`, `keywords` は用いない

```json
{
  "private": true,
  "type": "module"
}
```

## Test Guidelines

- 同じモックを複数のテストファイルで使う場合は、共通の mock factory を関数として export し各テストファイルから呼び出す
- DBや外部リソースを共有するテスト同士の干渉を防ぐため「並列耐性」のある形で記述する
  - 同一ファイル内で固有のprefixを共有することを禁じる。テスト毎に `task.id` などのtestごとに unique となる値を prefix として利用し、seed を分離する
  - `beforeAll` で共通の seed データを作成することを禁じる。`beforeAll` は接続と必要最小限の truncate のみに留め、seed は各テスト内で `task.id` prefix を付けて作成する
  - 共有リソース全体に依存する assertion (例: `count`, `length`) を禁じる。`find()` 等で自テストが作成したレコードのみを対象に assertion する
- サンプルとNGパターンは [references/tests.md](references/tests.md) を参照

## TypeScript Guidelines

- 既に存在する型は再定義せず推論で導出し再定義を禁じる（対象を限らずすべての型に適用）
  - 詳細は [references/type-inference.md](references/type-inference.md) を参照
- baseUrlを利用しない
- npm workspaces monorepoで他packageを参照する場合、tsconfigの `paths` エイリアスを禁じる
  - `paths` はpackage.jsonの `exports` マップ検証をバイパスし、存在しないsubpath importがコンパイルを通って実行時の `ERR_PACKAGE_PATH_NOT_EXPORTED` で初めて発覚する
  - 代わりにProject References（参照先packageは `composite: true` と `declarationMap: true`）に一本化する
- 可能な場合は必ず `as const` を記述する
- TypeScriptファイルを直接実行する場合はNode.jsのnative type strippingを利用する
  - Node.js 22.18.0 / 23.6.0以降はデフォルト有効のため `--experimental-strip-types` フラグは付与しない（`node file.ts` で実行する）
  - `ts-node`, `tsx` の利用を禁じる
  - ref: https://nodejs.org/docs/api/typescript.html
- TypeScriptが明示された機能変更では、CLIだけでなく機能固有の新規runtime helper・client/config・fake-client testも`.ts`にそろえる。`tsconfig`とtest discovery/package scriptに含め、JavaScriptのまま残る機能実装を作らない
- 無関係な既存JavaScriptは暗黙に全面移行せず、残す境界を明示する。JavaScript callerのimportを変える場合は、Node strip-typesによる実行互換性も検証する
- 既存の `.mjs` 実行entrypointを `.ts` へ移す場合は、`package.json` の実行・syntax-check script、`tsconfig` の対象、test discovery、READMEやcron/deployの起動参照を同じ変更で更新し、旧entrypoint参照を検出する回帰testを追加する
- JavaScriptからTypeScriptへの移行では、型guardの厳格化が旧実装で許容していた入力（特に`null`・未指定値・空値）を拒否しないか、既存validatorと呼出先の挙動を照合する。意図した契約変更でない限り同じruntime effectへ正規化し、境界値をoffline regression testで固定する
- 外部APIを呼ぶcollectorの移行確認では、明示承認なしに実APIを実行せず、型検査とfake-client/unit testsを使う。実APIでの確認が必要なら別の承認ゲートとして扱う

## Node.js CLI Tool Guidelines

Node.js CLIツールを作成する場合は以下に従う。

- ファイルの先頭に `#!/usr/bin/env node` を付与する
- 引数解析は `node:util` から `parseArgs` をインポートして利用し、手書きパーサは避ける
- TypeScriptで記述し、Node.jsのstrip-typesで実行する
- subprocess、artifact出力、baseline比較、filesystem cleanup、外部review gateのいずれかを扱う場合は`fail-closed-automation` skillもloadし、そのsubprocess・artifact ownership・TOCTOU規則を適用する

### CLI用 package.json Template

`bin` は strip-types で直接実行する `.ts` ファイルを指す（`.js` へのビルドは行わない）。

```json
{
  "private": true,
  "type": "module",
  "bin": {
    "my-cli": "./bin/cli.ts"
  }
}
```

### CLI Entry Point Template (`bin/cli.ts`)

```typescript
#!/usr/bin/env node
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  options: {
    help: {
      type: 'boolean',
      short: 'h',
      default: false,
    }
  },
  allowPositionals: true,
})

function showHelp() {
  console.log(`Usage: my-cli <command> [options]

Options:
  -h, --help  Show this help message`)
}

async function main() {
  if (values.help) {
    showHelp()
    return
  }
  // ここにメイン処理を実装する
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
```

### CLI用 tsconfig.json Template

```json
{
  "compilerOptions": {
    "incremental": true,
    "strict": true,
    "outDir": "dist",
    "sourceMap": true,
    "esModuleInterop": true,
    "target": "esnext",
    "module": "nodenext",
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "allowImportingTsExtensions": true
  }
}
```

## Mandatory Skill Enforcement

- このskillがloadされたら、変更した `.ts` / `.js` ファイルに対して完了前に `scripts/check.ts` を実行し、errorが0件になるまで修正すること
- 変更したファイルを完了前に再読し、このskillの禁止事項に違反していないか必ず確認すること。skillのlint設定が適用された場合はlintで判定できない項目(`as const`、型の再定義、テストの並列耐性、Date Handling、Scripting、package.json・tsconfig・npmの設定、Node.js CLI Tool Guidelines)を、project設定が使われた場合はこのSKILL.mdのguideline全体を確認対象とする。project設定が使われた場合、skillのlint設定でのみ定義されたルールは適用せず、projectのlint/format規約に従う
- skill違反が見つかった場合、その時点で未完了として扱い、説明や完了報告より先に修正すること
