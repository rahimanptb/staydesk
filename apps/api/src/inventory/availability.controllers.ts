import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  availabilityCheckSchema,
  availabilityGridQuerySchema,
  blockListQuerySchema,
  createBlockSchema,
  createStopSellSchema,
  releaseBlockSchema,
  stopSellListQuerySchema,
  type AvailabilityGrid,
  type AvailabilityQuote,
  type BlockReleaseResult,
  type BlockView,
  type StopSellView,
} from '@staydesk/contracts';
import type { FastifyReply } from 'fastify';
import { CurrentPrincipal, ForContext, RequirePermission } from '../auth/decorators.js';
import type { Principal } from '../auth/principal.js';
import { idempotencyKeyFrom } from '../common/idempotency.js';
import { parseInput } from '../common/validation.js';
import { AvailabilityService } from './availability.service.js';
import { BlocksService } from './blocks.service.js';
import { StopSellsService } from './stop-sells.service.js';

const uuid = new ParseUUIDPipe({ version: '7', errorHttpStatusCode: 404 });

@Controller('properties/:propertyId/availability')
@ForContext('TENANT')
export class AvailabilityController {
  constructor(@Inject(AvailabilityService) private readonly availability: AvailabilityService) {}

  @Get()
  @RequirePermission('availability.view')
  grid(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Query() query: unknown,
  ): Promise<AvailabilityGrid> {
    return this.availability.grid(p, propertyId, parseInput(availabilityGridQuerySchema, query));
  }

  @Post('check')
  @HttpCode(200)
  @RequirePermission('availability.view')
  check(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Body() body: unknown,
  ): Promise<AvailabilityQuote> {
    return this.availability.check(p, propertyId, parseInput(availabilityCheckSchema, body));
  }
}

/** Blocks and out-of-service periods; create/release permissions depend on the kind. */
@Controller('properties/:propertyId/blocks')
@ForContext('TENANT')
export class BlocksController {
  constructor(@Inject(BlocksService) private readonly blocks: BlocksService) {}

  @Get()
  @RequirePermission('block.view')
  list(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Query() query: unknown,
  ): Promise<BlockView[]> {
    return this.blocks.list(p, propertyId, parseInput(blockListQuerySchema, query));
  }

  @Post()
  @RequirePermission('block.view')
  async create(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BlockView> {
    const idempotencyKey = idempotencyKeyFrom(key);
    const { block, replayed } = await this.blocks.create(
      p,
      propertyId,
      idempotencyKey,
      parseInput(createBlockSchema, body),
    );
    if (replayed) void reply.header('idempotent-replayed', 'true');
    return block;
  }

  @Get(':blockId')
  @RequirePermission('block.view')
  get(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Param('blockId', uuid) blockId: string,
  ): Promise<BlockView> {
    return this.blocks.get(p, propertyId, blockId);
  }

  @Post(':blockId/release')
  @HttpCode(200)
  @RequirePermission('block.view')
  release(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Param('blockId', uuid) blockId: string,
    @Body() body: unknown,
  ): Promise<BlockReleaseResult> {
    return this.blocks.release(p, propertyId, blockId, parseInput(releaseBlockSchema, body));
  }
}

@Controller('properties/:propertyId/stop-sells')
@ForContext('TENANT')
export class StopSellsController {
  constructor(@Inject(StopSellsService) private readonly stopSells: StopSellsService) {}

  @Get()
  @RequirePermission('availability.view')
  list(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Query() query: unknown,
  ): Promise<StopSellView[]> {
    return this.stopSells.list(p, propertyId, parseInput(stopSellListQuerySchema, query).status);
  }

  @Post()
  @RequirePermission('stopSell.manage')
  create(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Body() body: unknown,
  ): Promise<StopSellView> {
    return this.stopSells.create(p, propertyId, parseInput(createStopSellSchema, body));
  }

  @Post(':stopSellId/lift')
  @HttpCode(200)
  @RequirePermission('stopSell.manage')
  lift(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Param('stopSellId', uuid) stopSellId: string,
  ): Promise<StopSellView> {
    return this.stopSells.lift(p, propertyId, stopSellId);
  }
}
