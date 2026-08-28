import { describe, expect, it } from 'bun:test'
import { Linter } from 'eslint'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const rule = require('../../../../scripts/eslint-rules/no-transition-all.cjs')

function runRule(code: string) {
  const linter = new Linter({ configType: 'eslintrc' })
  linter.defineRule('craft-styles/no-transition-all', rule)

  return linter.verify(code, {
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: { 'craft-styles/no-transition-all': 'error' },
  })
}

describe('no-transition-all', () => {
  it('rejects broad transition utilities in strings and templates', () => {
    expect(runRule("const a = 'rounded transition-all'")).toHaveLength(1)
    expect(runRule('const a = `rounded transition-all`')).toHaveLength(1)
  })

  it('allows explicit transition properties', () => {
    expect(runRule("const a = 'transition-[color,opacity,transform]' ")).toHaveLength(0)
  })
})
