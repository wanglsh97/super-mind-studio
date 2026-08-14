import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const GEN_IMAGE_SKILL = Symbol('GEN_IMAGE_SKILL');
export const GEN_IMAGE_SKILL_NAME = 'gen-image';

export interface GenImageSkill {
  name: typeof GEN_IMAGE_SKILL_NAME;
  description: string;
  instructions: string;
  skillMarkdown: string;
}

export function loadGenImageSkill(root = resolveGenImageSkillRoot()): GenImageSkill {
  const path = resolve(root, 'SKILL.md');
  if (!existsSync(path)) throw new Error(`Built-in Skill file is missing: ${path}`);
  const skillMarkdown = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]+)$/.exec(skillMarkdown);
  if (!match) throw new Error('Built-in gen-image SKILL.md must contain frontmatter');
  const metadata = new Map<string, string>();
  for (const line of match[1]!.split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) throw new Error(`Invalid gen-image Skill frontmatter line: ${line}`);
    metadata.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  const name = metadata.get('name');
  const description = metadata.get('description');
  const instructions = match[2]!.trim();
  if (name !== GEN_IMAGE_SKILL_NAME || !description || !instructions) {
    throw new Error(`Built-in Skill name must be ${GEN_IMAGE_SKILL_NAME}`);
  }
  return Object.freeze({ name, description, instructions, skillMarkdown });
}

export function renderGenImageSkill(skill: GenImageSkill, capabilities: string): string {
  return `<built_in_skill id="${skill.name}">\n${skill.instructions}\n\n当前图片模型能力：\n${capabilities}\n</built_in_skill>`;
}

function resolveGenImageSkillRoot(): string {
  const root = resolve(__dirname, '../../../../skills', GEN_IMAGE_SKILL_NAME);
  if (!existsSync(root)) throw new Error(`Built-in Skill directory is missing: ${root}`);
  return root;
}
