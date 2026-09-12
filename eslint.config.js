import compat from 'eslint-plugin-compat';

export default [
  {
    ignores: [

    ]
  },
  {
    ...compat.configs['flat/recommended'],
    files: ['src/**/*.js'],
    languageOptions: {
      ...compat.configs['flat/recommended'].languageOptions,
      ecmaVersion: 2022,
      sourceType: 'module'
    }
  }
];
