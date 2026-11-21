import { Body, Controller, Post } from './nest.js';
import { SharedPayloadDto } from './shared.dto.js';

// Owns SharedPayloadDto: its path sorts before beta.controller.ts.
@Controller('alpha')
export class AlphaController {
  @Post()
  create(@Body() dto: SharedPayloadDto): void {
    void dto;
  }
}
