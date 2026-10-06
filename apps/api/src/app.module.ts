import { Global, Module, type DynamicModule } from '@nestjs/common';
import { API_ENV, type ApiEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';

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

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [EnvModule.forRoot(env), DatabaseModule],
      controllers: [HealthController],
    };
  }
}
