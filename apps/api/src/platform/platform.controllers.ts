import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  createTenantSchema,
  planEntitlementsSchema,
  planSchema,
  tenantStatusChangeSchema,
  updatePlanSchema,
  updatePlatformTenantSchema,
} from '@staydesk/contracts';
import { CurrentPrincipal, ForContext, RequirePermission } from '../auth/decorators.js';
import type { Principal } from '../auth/principal.js';
import { parseInput } from '../common/validation.js';
import { PlansService, type PlanView } from './plans.service.js';
import { TenantsService, type PlatformTenantView } from './tenants.service.js';

const uuid = new ParseUUIDPipe({ version: '7', errorHttpStatusCode: 404 });

@Controller('platform/tenants')
@ForContext('PLATFORM')
export class PlatformTenantsController {
  constructor(@Inject(TenantsService) private readonly tenants: TenantsService) {}

  @Get()
  @RequirePermission('platform.tenant.view')
  list(): Promise<PlatformTenantView[]> {
    return this.tenants.list();
  }

  @Get(':id')
  @RequirePermission('platform.tenant.view')
  get(@Param('id', uuid) id: string): Promise<PlatformTenantView> {
    return this.tenants.get(id);
  }

  @Post()
  @RequirePermission('platform.tenant.manage')
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
  ): Promise<PlatformTenantView> {
    return this.tenants.create(principal, parseInput(createTenantSchema, body));
  }

  @Patch(':id')
  @RequirePermission('platform.tenant.manage')
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<PlatformTenantView> {
    return this.tenants.update(principal, id, parseInput(updatePlatformTenantSchema, body));
  }

  @Post(':id/activate')
  @RequirePermission('platform.tenant.manage')
  @HttpCode(200)
  activate(@CurrentPrincipal() p: Principal, @Param('id', uuid) id: string, @Body() body: unknown) {
    return this.tenants.setStatus(
      p,
      id,
      'ACTIVE',
      parseInput(tenantStatusChangeSchema, body).reason,
    );
  }

  @Post(':id/suspend')
  @RequirePermission('platform.tenant.manage')
  @HttpCode(200)
  suspend(@CurrentPrincipal() p: Principal, @Param('id', uuid) id: string, @Body() body: unknown) {
    return this.tenants.setStatus(
      p,
      id,
      'SUSPENDED',
      parseInput(tenantStatusChangeSchema, body).reason,
    );
  }

  @Post(':id/deactivate')
  @RequirePermission('platform.tenant.manage')
  @HttpCode(200)
  deactivate(
    @CurrentPrincipal() p: Principal,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    return this.tenants.setStatus(
      p,
      id,
      'DEACTIVATED',
      parseInput(tenantStatusChangeSchema, body).reason,
    );
  }
}

@Controller('platform/plans')
@ForContext('PLATFORM')
export class PlatformPlansController {
  constructor(@Inject(PlansService) private readonly plans: PlansService) {}

  @Get()
  @RequirePermission('platform.plan.manage')
  list(): Promise<PlanView[]> {
    return this.plans.list();
  }

  @Post()
  @RequirePermission('platform.plan.manage')
  create(@CurrentPrincipal() principal: Principal, @Body() body: unknown): Promise<PlanView> {
    return this.plans.create(principal, parseInput(planSchema, body));
  }

  @Patch(':id')
  @RequirePermission('platform.plan.manage')
  update(@CurrentPrincipal() p: Principal, @Param('id', uuid) id: string, @Body() body: unknown) {
    return this.plans.update(p, id, parseInput(updatePlanSchema, body));
  }

  @Put(':id/entitlements')
  @RequirePermission('platform.plan.manage')
  setEntitlements(
    @CurrentPrincipal() p: Principal,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    return this.plans.setEntitlements(p, id, parseInput(planEntitlementsSchema, body).entitlements);
  }
}
