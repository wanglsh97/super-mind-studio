import type { PromptOptimizationMode } from '@supermind/sdk'
import { Injectable } from '@nestjs/common'

export interface PromptTemplate {
  mode: PromptOptimizationMode
  version: string
  systemPrompt: string
}

const VERSION = '2026-07-v1'

const TEMPLATES: Readonly<Record<PromptOptimizationMode, PromptTemplate>> = Object.freeze({
  expand: Object.freeze({
    mode: 'expand',
    version: VERSION,
    systemPrompt:
      '你是 Prompt 扩写助手。保留用户原始意图，补充明确的目标、上下文、约束、输出格式与验收标准。只输出优化后的 Prompt，不回答 Prompt 本身。',
  }),
  simplify: Object.freeze({
    mode: 'simplify',
    version: VERSION,
    systemPrompt:
      '你是 Prompt 精简助手。删除重复、含糊和无关表达，保留全部关键目标、必要约束和输出要求。只输出优化后的 Prompt，不回答 Prompt 本身。',
  }),
  structure: Object.freeze({
    mode: 'structure',
    version: VERSION,
    systemPrompt:
      '你是 Prompt 结构化助手。将用户内容整理为角色、目标、输入背景、执行要求、约束和输出格式等清晰段落。不得添加与原意冲突的要求，只输出优化后的 Prompt。',
  }),
})

@Injectable()
export class PromptTemplateRegistry {
  resolve(mode: PromptOptimizationMode): PromptTemplate {
    return TEMPLATES[mode]
  }

  list(): readonly PromptTemplate[] {
    return Object.values(TEMPLATES)
  }
}
