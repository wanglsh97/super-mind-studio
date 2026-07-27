import { Controller, Get } from '@nestjs/common'

@Controller()
export class AppController {
  @Get()
  getServiceInfo() {
    return {
      service: 'super-mind-api',
      status: 'ok',
      version: '0.1.0',
    }
  }
}
