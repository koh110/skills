# Claude Code adapter

Trigger this skill for Git operations and for repository edits that may later be committed or reviewed. Trigger it before the first file edit, not when a commit or PR is requested.

When triggered:
- load `../SKILL.md`
- load `../policies/default.md`
- determine worktree state from Git metadata rather than directory naming

Claude Code may create linked worktrees under runtime-owned paths such as `.claude/worktrees/<name>/`. If `git_dir != common_dir`, treat it as an existing linked worktree and follow the policy to reuse it instead of creating another worktree.

## Sandboxed shell

When the shell runs commands inside a sandbox by default, some Git operations fail halfway and leave partial state (for example, a branch created without its worktree). Run these outside the sandbox from the first attempt instead of retrying after a failure:

- `git worktree add` / `git worktree remove`
- signed `git commit` (the signing agent socket is not reachable from the sandbox)
- `git push` and `gh` commands that read the user's `gh` configuration

Before a signed commit, tell the user that the signing agent may ask for approval. A signing attempt inside the sandbox can leave a stale approval dialog behind.

A temporary directory resolves to different paths inside and outside the sandbox. Pass absolute paths for files that cross that boundary.

When a filtered pipeline (`cmd 2>&1 | grep ...`) prints nothing, check the exit status and unfiltered stderr before concluding there was no match. A sandbox denial can be hidden by the filter.
