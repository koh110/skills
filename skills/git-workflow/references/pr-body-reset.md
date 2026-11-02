# PR and Issue body update pattern

Use a temporary file and `--body-file` for multiline PR/Issue bodies and comments. Inline `--body` arguments are vulnerable to shell parsing and Markdown quoting errors.

## Existing-body update

1. Read the current body and `updatedAt`; save the exact body as a snapshot.
2. Change only the requested section by default. Preserve unrelated sections, `<details>` blocks, and automation-managed text. Rebuild the entire body only for an explicit whole-body rewrite.
3. Immediately before writing, read the body and `updatedAt` again. `updatedAt` can change for non-body activity, so compare body bytes with the saved snapshot: if the body changed, reconcile or stop; if only `updatedAt` changed, rebuild from the latest snapshot and recheck. Wait for known automation updates to settle. This is optimistic detection, not atomic compare-and-set; serialize writers when concurrent edits are possible.
4. Write the intended body to a private temporary file and use `gh pr edit <number> --repo <owner>/<repo> --body-file <file>` or the corresponding `gh issue` command.
5. Fetch the body again and compare its exact bytes with the intended file. For REST JSON, pipe the response through `jq -j '.body'` to avoid adding a newline. Read back the object URL and state too.

For a comment, use the matching `gh pr comment` / `gh issue comment` `--body-file` option, retain the created comment URL or ID, and read the comment back. The same authorization policy applies to body edits and comments as to any other remote write.

## Create a PR

```bash
body_file=$(mktemp)
trap 'rm -f "$body_file"' EXIT
cat >"$body_file" <<'BODY'
## Summary
- <verified change summary>

## Verification
- <commands actually run and measured result>
BODY

gh pr create \
  --repo <owner>/<repo> \
  --base <resolved-base> \
  --head <branch> \
  --title "docs: <short summary>" \
  --body-file "$body_file"
```

For a whole-body rewrite, prepare the complete new body from the latest snapshot. For a targeted edit, retain all content outside the requested section. Do not paste long Markdown bodies directly into shell-quoted arguments.
