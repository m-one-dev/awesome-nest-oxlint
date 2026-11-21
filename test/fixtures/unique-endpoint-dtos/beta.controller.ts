import { ApiOkResponse, Body, Controller, Get, Post } from './nest.js';
import { SharedPayloadDto } from './shared.dto.js';

// Uses SharedPayloadDto again, as a body and as a response: both duplicate alpha.controller.ts.
@Controller('beta')
export class BetaController {
  @Post()
  create(@Body() dto: SharedPayloadDto): void {
    void dto;
  }

  @Get()
  @ApiOkResponse({ type: SharedPayloadDto })
  fetch(): void {}
}
