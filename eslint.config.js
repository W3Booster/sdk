import compat from 'eslint-plugin-compat';

export default [
  {
    ignores: [

    ]
  },
  {
    ...compat.configs['flat/recommended'],
    files: ['src/**/*.js'],
    rules: {
      ...compat.configs['flat/recommended'].rules,
      // The compatibility plugin does not infer methods on an options.signal.
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='throwIfAborted']",
        message: 'Use the internal throwIfAborted helper; Electron 15 has no AbortSignal.throwIfAborted.'
      }]
    },
    languageOptions: {
      ...compat.configs['flat/recommended'].languageOptions,
      ecmaVersion: 2022,
      sourceType: 'module'
    }
  }
];
