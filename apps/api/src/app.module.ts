import { Global, Module, type DynamicModule } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { API_ENV, type ApiEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import {
  PlatformPlansController,
  PlatformTenantsController,
} from './platform/platform.controllers.js';
import { PlansService } from './platform/plans.service.js';
import { TenantsService } from './platform/tenants.service.js';
import { RolesService } from './tenant/roles.service.js';
import {
  AuditLogController,
  RolesController,
  TenantProfileController,
  UsersController,
} from './tenant/tenant.controllers.js';
import { UsersService } from './tenant/users.service.js';
import { EntitlementsService } from './inventory/entitlements.service.js';
import {
  PropertiesController,
  RoomTypesController,
  RoomsController,
} from './inventory/inventory.controllers.js';
import { PropertiesService } from './inventory/properties.service.js';
import { RoomTypesService } from './inventory/room-types.service.js';
import { RoomsService } from './inventory/rooms.service.js';
import {
  AvailabilityController,
  BlocksController,
  StopSellsController,
} from './inventory/availability.controllers.js';
import { AvailabilityService } from './inventory/availability.service.js';
import { BlocksService } from './inventory/blocks.service.js';
import { StopSellsService } from './inventory/stop-sells.service.js';

@Global()
@Module({})
class EnvModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: EnvModule,
      providers: [{ provide: API_ENV, useValue: env }],
      exports: [API_ENV],
    };
  }
}

@Module({
  controllers: [PlatformTenantsController, PlatformPlansController],
  providers: [TenantsService, PlansService],
})
class PlatformModule {}

@Module({
  controllers: [
    TenantProfileController,
    UsersController,
    RolesController,
    AuditLogController,
    PropertiesController,
    RoomTypesController,
    RoomsController,
    AvailabilityController,
    BlocksController,
    StopSellsController,
  ],
  providers: [
    UsersService,
    RolesService,
    EntitlementsService,
    PropertiesService,
    RoomTypesService,
    RoomsService,
    AvailabilityService,
    BlocksService,
    StopSellsService,
  ],
})
class TenantModule {}

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [EnvModule.forRoot(env), DatabaseModule, AuthModule, PlatformModule, TenantModule],
      controllers: [HealthController],
    };
  }
}
