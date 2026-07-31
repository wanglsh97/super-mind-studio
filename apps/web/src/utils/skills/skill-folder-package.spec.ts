import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseSkillFrontmatter } from './skill-folder-package'

describe('parseSkillFrontmatter', () => {
  it('supports legacy OpenClaw frontmatter with an indented version and description', () => {
    const parsed = parseSkillFrontmatter(`---
name: 命理大师
  version: 1.2.6
  description: |
    命理参考工具。
metadata:
  displayName: 命理大师
  openclaw:
    skillKey: university-applications
---

# 内容`)

    assert.deepEqual(parsed, {
      name: 'university-applications',
      title: '命理大师',
      description: '命理参考工具。',
    })
  })
})
