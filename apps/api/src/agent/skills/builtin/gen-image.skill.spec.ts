import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadGenImageSkill, renderGenImageSkill } from './gen-image.skill';

describe('built-in gen-image Skill', () => {
  it('loads the immutable package and renders runtime capabilities after instructions', () => {
    const skill = loadGenImageSkill();
    const rendered = renderGenImageSkill(skill, '- qwen-image｜Qwen Image');
    expect(skill.name).toBe('gen-image');
    expect(rendered.indexOf('每个 Run 最多调用一次')).toBeLessThan(rendered.indexOf('qwen-image'));
  });

  it('fails fast when the package name is inconsistent', () => {
    const root = mkdtempSync(join(tmpdir(), 'gen-image-invalid-'));
    writeFileSync(join(root, 'SKILL.md'), '---\nname: wrong\ndescription: invalid\n---\nbody\n');
    expect(() => loadGenImageSkill(root)).toThrow('Built-in Skill name must be gen-image');
  });
});
