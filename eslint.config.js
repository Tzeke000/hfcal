// Deliberately minimal: ONLY the React hooks rules. This is not a style
// linter — it exists because a missing entry in a dependency array served
// stale month/power through the AI layer for two releases (VALIDATION.md
// Part 31), and that defect class is mechanically detectable. Style rules
// would bury the signal this config exists to surface.
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    files: ['src/**/*.jsx', 'src/**/*.js'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
];
