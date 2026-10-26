// Commit messages follow Conventional Commits (https://www.conventionalcommits.org):
//
//   feat(connectors): map GitLab merge requests
//   fix(ingest): keep Slack edits on the same activity
//   docs: explain the noise rules
//
// Types: feat, fix, docs, refactor, perf, test, build, ci, chore, revert, style.
// The scope is optional; use the folder or area you changed.
export default {
  extends: ["@commitlint/config-conventional"],
};
