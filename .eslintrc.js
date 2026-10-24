module.exports = {
    'env': {
        'es2021': true,
        'node': true
    },
    'extends': [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended'
    ],
    'parser': '@typescript-eslint/parser',
    'parserOptions': {
        'ecmaVersion': 12,
        'sourceType': 'module'
    },
    'plugins': [
        'modules-newline',
        '@typescript-eslint'
    ],
    'rules': {
        '@typescript-eslint/indent': [
            'off'
        ],
        'linebreak-style': 'off',
        'quotes': [
            'off'
        ],
        'semi': [
            'off'
        ],
        '@typescript-eslint/no-explicit-any': 'off',
        'prefer-arrow-callback': 'off'
    }
}
