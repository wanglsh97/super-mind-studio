import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  loadWebsiteBuildingSkill,
  renderWebsiteBuildingSkill,
  WEBSITE_BUILDING_SKILL_NAME,
} from './website-building.skill'

describe('website-building built-in Skill', () => {
  it('loads the standard repository Skill bundle and renders only its body into website prompts', () => {
    const skill = loadWebsiteBuildingSkill()

    expect(skill.name).toBe(WEBSITE_BUILDING_SKILL_NAME)
    expect(skill.skillMarkdown).toContain('name: website-building')
    expect(skill.instructions).not.toContain('name: website-building')
    expect(skill.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'scripts/init.sh',
      'scripts/package.py',
    ])
    expect(renderWebsiteBuildingSkill(skill)).toContain('<built_in_skill id="website-building"')
  })

  it('fails startup loading when frontmatter does not match the immutable Skill name', () => {
    const root = mkdtempSync(join(tmpdir(), 'website-building-'))
    mkdirSync(join(root, 'scripts'))
    writeFileSync(join(root, 'SKILL.md'), '---\nname: wrong-name\ndescription: Invalid\n---\n\n# X')
    writeFileSync(join(root, 'scripts/init.sh'), '#!/bin/sh\n')
    writeFileSync(join(root, 'scripts/package.py'), 'print("ok")\n')

    expect(() => loadWebsiteBuildingSkill(root)).toThrow(
      'Built-in Skill name must be website-building',
    )
  })
})
