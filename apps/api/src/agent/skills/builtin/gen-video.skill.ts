import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export const GEN_VIDEO_SKILL = Symbol('GEN_VIDEO_SKILL');
export const GEN_VIDEO_SKILL_NAME = 'gen-video';
export interface GenVideoSkill {
  name: typeof GEN_VIDEO_SKILL_NAME;
  description: string;
  instructions: string;
  skillMarkdown: string;
}
export function loadGenVideoSkill(
  root = resolve(__dirname, '../../../../skills', GEN_VIDEO_SKILL_NAME),
): GenVideoSkill {
  const path = resolve(root, 'SKILL.md');
  if (!existsSync(path)) throw new Error(`Built-in Skill file is missing: ${path}`);
  const skillMarkdown = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]+)$/.exec(skillMarkdown);
  if (!match) throw new Error('Built-in gen-video SKILL.md must contain frontmatter');
  const name = /^name:\s*(.+)$/m.exec(match[1]!)?.[1]?.trim();
  const description = /^description:\s*(.+)$/m.exec(match[1]!)?.[1]?.trim();
  if (name !== GEN_VIDEO_SKILL_NAME || !description) throw new Error('Invalid gen-video Skill');
  return { name, description, instructions: match[2]!.trim(), skillMarkdown };
}
export function renderGenVideoSkill(skill: GenVideoSkill, capabilities: string) {
  return `<built_in_skill id="${skill.name}">\n${skill.instructions}\n\n当前视频模型聚合能力：\n${capabilities}\n</built_in_skill>`;
}
