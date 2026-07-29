import { MODULE_METADATA } from '@nestjs/common/constants'

import { ModelGatewayModule } from './model-gateway.module'
import { ModelsController } from './models.controller'

describe('ModelGatewayModule', () => {
  it('registers model discovery without a public Chat completions controller', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ModelGatewayModule)).toEqual([
      ModelsController,
    ])
  })
})
