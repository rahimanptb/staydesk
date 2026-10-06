import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  createHolidaySchema,
  createPropertySchema,
  createRoomTypeSchema,
  createRoomsSchema,
  updatePropertySchema,
  updateRoomSchema,
  updateRoomTypeSchema,
  type HolidayView,
  type PropertyView,
  type RoomTypeView,
  type RoomView,
} from '@staydesk/contracts';
import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import { CurrentPrincipal, ForContext, RequirePermission } from '../auth/decorators.js';
import type { Principal } from '../auth/principal.js';
import { parseInput } from '../common/validation.js';
import { PropertiesService } from './properties.service.js';
import { RoomTypesService, versionFrom } from './room-types.service.js';
import { RoomsService } from './rooms.service.js';

const uuid = new ParseUUIDPipe({ version: '7', errorHttpStatusCode: 404 });

@Controller('properties')
@ForContext('TENANT')
export class PropertiesController {
  constructor(@Inject(PropertiesService) private readonly properties: PropertiesService) {}

  @Get()
  @RequirePermission('property.view')
  list(@CurrentPrincipal() p: Principal): Promise<PropertyView[]> {
    return this.properties.list(p);
  }

  @Post()
  @RequirePermission('property.manage')
  create(@CurrentPrincipal() p: Principal, @Body() body: unknown): Promise<PropertyView> {
    return this.properties.create(p, parseInput(createPropertySchema, body));
  }

  @Get(':propertyId')
  @RequirePermission('property.view')
  get(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) id: string,
  ): Promise<PropertyView> {
    return this.properties.get(p, id);
  }

  @Patch(':propertyId')
  @RequirePermission('property.manage')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) id: string,
    @Body() body: unknown,
  ): Promise<PropertyView> {
    return this.properties.update(p, id, parseInput(updatePropertySchema, body));
  }

  @Post(':propertyId/archive')
  @RequirePermission('property.manage')
  @HttpCode(204)
  archive(@CurrentPrincipal() p: Principal, @Param('propertyId', uuid) id: string): Promise<void> {
    return this.properties.archive(p, id);
  }

  @Get(':propertyId/holidays')
  @RequirePermission('property.view')
  holidays(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) id: string,
    @Query() query: unknown,
  ): Promise<HolidayView[]> {
    const { year } = parseInput(
      z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
      query,
    );
    return this.properties.holidays(p, id, year);
  }

  @Post(':propertyId/holidays')
  @RequirePermission('property.manage')
  addHoliday(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) id: string,
    @Body() body: unknown,
  ): Promise<HolidayView> {
    return this.properties.addHoliday(p, id, parseInput(createHolidaySchema, body));
  }

  @Delete(':propertyId/holidays/:holidayId')
  @RequirePermission('property.manage')
  @HttpCode(204)
  removeHoliday(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) id: string,
    @Param('holidayId', uuid) holidayId: string,
  ): Promise<void> {
    return this.properties.removeHoliday(p, id, holidayId);
  }
}

@Controller('properties/:propertyId/room-types')
@ForContext('TENANT')
export class RoomTypesController {
  constructor(@Inject(RoomTypesService) private readonly roomTypes: RoomTypesService) {}

  @Get()
  @RequirePermission('roomType.view')
  list(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Query() query: unknown,
  ): Promise<RoomTypeView[]> {
    const { includeArchived } = parseInput(
      z.object({ includeArchived: z.enum(['true', 'false']).optional() }),
      query,
    );
    return this.roomTypes.list(p, propertyId, includeArchived === 'true');
  }

  @Post()
  @RequirePermission('roomType.manage')
  async create(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RoomTypeView> {
    const created = await this.roomTypes.create(
      p,
      propertyId,
      parseInput(createRoomTypeSchema, body),
    );
    void reply.header('etag', `"v${created.version}"`);
    return created;
  }

  @Get(':roomTypeId')
  @RequirePermission('roomType.view')
  async get(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Param('roomTypeId', uuid) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RoomTypeView> {
    const roomType = await this.roomTypes.get(p, propertyId, id);
    void reply.header('etag', `"v${roomType.version}"`);
    return roomType;
  }

  @Patch(':roomTypeId')
  @RequirePermission('roomType.manage')
  async update(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Param('roomTypeId', uuid) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RoomTypeView> {
    const version = versionFrom(ifMatch);
    const updated = await this.roomTypes.update(
      p,
      propertyId,
      id,
      version,
      parseInput(updateRoomTypeSchema, body),
    );
    void reply.header('etag', `"v${updated.version}"`);
    return updated;
  }

  @Post(':roomTypeId/archive')
  @RequirePermission('roomType.manage')
  @HttpCode(204)
  archive(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Param('roomTypeId', uuid) id: string,
  ): Promise<void> {
    return this.roomTypes.archive(p, propertyId, id);
  }
}

@Controller('properties/:propertyId/rooms')
@ForContext('TENANT')
export class RoomsController {
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}

  @Get()
  @RequirePermission('room.view')
  list(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Query() query: unknown,
  ): Promise<RoomView[]> {
    const { roomTypeId } = parseInput(z.object({ roomTypeId: z.uuid().optional() }), query);
    return this.rooms.list(p, propertyId, roomTypeId);
  }

  @Post()
  @RequirePermission('room.manage')
  create(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Body() body: unknown,
  ): Promise<RoomView[]> {
    return this.rooms.create(p, propertyId, parseInput(createRoomsSchema, body));
  }

  @Patch(':roomId')
  @RequirePermission('room.manage')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Param('roomId', uuid) id: string,
    @Body() body: unknown,
  ): Promise<RoomView> {
    return this.rooms.update(p, propertyId, id, parseInput(updateRoomSchema, body));
  }

  @Post(':roomId/archive')
  @RequirePermission('room.manage')
  @HttpCode(204)
  archive(
    @CurrentPrincipal() p: Principal,
    @Param('propertyId', uuid) propertyId: string,
    @Param('roomId', uuid) id: string,
  ): Promise<void> {
    return this.rooms.archive(p, propertyId, id);
  }
}
