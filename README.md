# koh110/skills

複数の agent runtime で共有する、公開可能な Skill package の source of truth です。Skill 本体・補助資料・補助スクリプトは `skills/<name>/` にまとめ、各 runtime へはこの repository から配布します。

## 配置ルール

- 公開可能な汎用 Skill はこの repository の `skills/` に置く。
- 非公開の cross-agent Skill は非公開の skill repository に置く。
- Hermes runtime 固有の運用は `~/.hermes/skills/` に置く。
- installed copy や mirror を直接編集せず、owner repository を変更する。

## 配布

`deploy.ts` は Node.js の native type stripping で実行し、package の snapshot を `~/.agents/skills` に実ファイルとして配置します。Node.js 22.6.0 以降が必要です。第三者 Skill は保持し、managed snapshot に手編集との競合がある場合は fail closed になります。Claude Code には互換 symlink を設定し、Codex / Copilot の旧runtime別 copy は整理します。

```bash
node --experimental-strip-types deploy.ts --all
node --experimental-strip-types deploy.ts --codex
node --experimental-strip-types deploy.ts --copilot
node --experimental-strip-types deploy.ts --claude
node --experimental-strip-types deploy.ts --claude --check
```

`--force` は確認済みの競合を上書きするときだけ指定してください。`--check` は Claude Code の既存展開との drift check 用です。従来の展開状態を引き継ぐため、manifest のファイル名 `~/.agents/.dotfiles-skills-manifest.json` は互換性維持の目的で残しています。

## 検証

```bash
npm test
```

## Repository layout

```text
skills/
  <skill-name>/
    SKILL.md
    policies/       # 任意
    profiles/       # 任意
    adapters/       # 任意
    references/     # 任意
    scripts/        # 任意（portable CLI・補助script・wrapper）
lib/                # 配布実装
```

Skill の形式には [Agent Skills](https://agentskills.io/) の `SKILL.md` を使います。各 package は他の Skill やこの README に依存せず、単独で利用できる形に保ちます。
