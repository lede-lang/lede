export default {
  extends: ['@commitlint/config-conventional'],
  // Dependabot writes "build(deps): Bump x from a to b". Its capital B fails subject-case, and the bot's messages are not ours to edit.
  ignores: [(message: string) => /^(build|ci)\(deps(-dev)?\): Bump /.test(message)],
};
