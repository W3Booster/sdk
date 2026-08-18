import compat from 'eslint-plugin-compat';

export default [
  {
    ignores: [
      'src/standard-game-icon-data.js',
      'src/standard-game-cooldown-data.js'
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
