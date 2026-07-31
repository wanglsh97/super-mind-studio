import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { validateSkillMetadata } from './skill-upload-form'

const validSkill = {
  name: 'example-skill',
  title: '示例技能',
  category: 'research',
}

describe('validateSkillMetadata', () => {
  it('allows a 300-character description', () => {
    const errors = validateSkillMetadata({
      ...validSkill,
      description: 'a'.repeat(300),
    })

    assert.deepEqual(errors, {})
  })

  it('rejects descriptions longer than 300 characters with the updated message', () => {
    const errors = validateSkillMetadata({
      ...validSkill,
      description: 'a'.repeat(301),
    })

    assert.equal(errors.description, '描述须为 1–300 个字符')
  })
})
