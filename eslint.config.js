import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Security-relevant rules from docs/10-security-architecture.md are enforced here so they
 * fail CI rather than relying on review.
 */
const bannedSyntax = [
  {
    selector: 'MemberExpression[property.name=/^\\$(queryRawUnsafe|executeRawUnsafe)$/]',
    message:
      'Unsafe raw SQL is banned. Use $queryRaw / $executeRaw tagged templates (parameterised).',
  },
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'dangerouslySetInnerHTML is banned (XSS). Render text, not HTML.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/src/generated/**',
      '**/next-env.d.ts',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-restricted-syntax': ['error', ...bannedSyntax],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    // Stay dates must never use JS Date (BR-02); LocalDate is the only bridge to instants.
    files: ['packages/domain/src/**/*.ts'],
    ignores: ['packages/domain/src/dates/local-date.ts', 'packages/domain/src/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...bannedSyntax,
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Use LocalDate for calendar dates.',
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
);
