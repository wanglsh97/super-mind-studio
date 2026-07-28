import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean } from 'class-validator'

export class UpdateAgentMcpServerDto {
  @ApiProperty({ description: '是否为当前用户启用该平台内置 MCP Server' })
  @IsBoolean()
  enabled!: boolean
}
