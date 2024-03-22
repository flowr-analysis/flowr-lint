module.exports = {
    "env": {
      "browser": false,
      "node": true,
      "es2022": true
    },
    "extends": [
      "eslint:recommended",
      "plugin:@typescript-eslint/recommended-requiring-type-checking",
      "plugin:@typescript-eslint/strict",
      "plugin:@typescript-eslint/recommended"
    ],
    "overrides": [],
    "parserOptions": {
      "ecmaVersion": "latest",
      "sourceType": "module",
      "project": "./tsconfig.json"
    },
    "parser": "@typescript-eslint/parser",
    "plugins": [
      "@typescript-eslint",
      "eslint-plugin-tsdoc",
      "check-file",
      "@stylistic",
      "@stylistic/js",
      "@stylistic/ts",
      "import"
    ],
    "rules": {
      "@stylistic/js/object-curly-spacing": [
        "error",
        "always"
      ],
      "@stylistic/js/indent": [
        "error",
        "tab",
        {
          "FunctionDeclaration": {
            "parameters": "first"
          },
          "ObjectExpression": 1,
          "SwitchCase": 1
        }
      ],
      "@stylistic/js/quotes": [
        "error",
        "single",
        {
          "avoidEscape": true
        }
      ],
      "@stylistic/no-mixed-spaces-and-tabs": [
        "error",
        "smart-tabs"
      ],
      "no-warning-comments": [
        "error",
        {
          "terms": [
            "todo",
            "fixme",
            "xxx"
          ],
          "location": "anywhere"
        }
      ],
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
      "@typescript-eslint/no-unsafe-enum-comparison": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        {
          "assertionStyle": "as"
        }
      ],
      "@stylistic/ts/key-spacing": [
        "error",
        {
          "align": "value"
        }
      ],
      "@stylistic/js/semi": [
        "error",
        "never"
      ],
      "@stylistic/js/space-before-function-paren": [
        "error",
        "never"
      ],
      "@stylistic/js/keyword-spacing": "off",
      "check-file/filename-naming-convention": [
        "error",
        {
          "**/*.ts": "?([A-Z])+([a-z])*((-|.)?([A-Z])+([a-z]))"
        }
      ],
      "check-file/folder-match-with-fex": [
        "error",
        {
          "*.spec.{js,jsx,ts,tsx}": "test/**"
        }
      ],
      "@stylistic/ts/keyword-spacing": [
        "error",
        {
          "before": true,
          "after": true,
          "overrides": {
            "if": {
              "after": false
            },
            "for": {
              "after": false
            },
            "while": {
              "after": false
            },
            "do": {
              "after": false
            },
            "catch": {
              "after": false
            },
            "switch": {
              "after": false
            },
            "default": {
              "after": false
            },
            "throw": {
              "after": false
            }
          }
        }
      ],
      "@stylistic/ts/space-before-function-paren": [
        "error",
        "never"
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          "argsIgnorePattern": "^_",
          "destructuredArrayIgnorePattern": "^_",
          "varsIgnorePattern": "^_"
        }
      ],
      "tsdoc/syntax": "error",
      "@typescript-eslint/naming-convention": [
        "error",
        {
          "selector": "variable",
          "modifiers": [
            "const",
            "global",
            "exported"
          ],
          "format": [
            "camelCase",
            "PascalCase",
            "UPPER_CASE"
          ],
          "leadingUnderscore": "allow",
          "trailingUnderscore": "allow"
        },
        {
          "selector": "variable",
          "modifiers": [
            "const"
          ],
          "format": [
            "camelCase",
            "PascalCase"
          ],
          "leadingUnderscore": "allow",
          "trailingUnderscore": "allow"
        },
        {
          "selector": "enumMember",
          "format": [
            "StrictPascalCase"
          ],
          "leadingUnderscore": "forbid",
          "trailingUnderscore": "forbid"
        },
        {
          "selector": "typeLike",
          "format": [
            "PascalCase"
          ]
        }
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "curly": "error",
      "@stylistic/js/brace-style": [
        "error",
        "1tbs"
      ],
      "@stylistic/js/new-parens": "error",
      "import/no-duplicates": "error"
    }
  }
