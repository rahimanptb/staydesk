import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  acceptInvitationSchema,
  forgotPasswordSchema,
  invitationTokenSchema,
  loginRequestSchema,
  mfaVerifySchema,
  resetPasswordSchema,
  selectContextSchema,
  totpEnableSchema,
  type InvitationPreview,
  type SessionInfo,
  type TotpSetup,
} from '@staydesk/contracts';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseInput } from '../common/validation.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { SESSION_POLICY, sessionCookieName } from './auth.constants.js';
import { AuthService, type SessionResult } from './auth.service.js';
import { CurrentPrincipal, Public, SessionOnly } from './decorators.js';
import { InvitationsService } from './invitations.service.js';
import type { Principal } from './principal.js';

@Controller('auth')
export class AuthController {
  private readonly cookieName: string;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.cookieName = sessionCookieName(env.COOKIE_SECURE);
  }

  private setSession(reply: FastifyReply, result: SessionResult): SessionInfo {
    void reply.setCookie(this.cookieName, result.token, {
      path: '/',
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax',
      maxAge: SESSION_POLICY[result.info.context].absoluteMs / 1000,
    });
    return result.info;
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionInfo> {
    const result = await this.auth.login(request.portal!, parseInput(loginRequestSchema, body));
    return this.setSession(reply, result);
  }

  @Get('session')
  @SessionOnly({ allowPendingMfa: true })
  session(@CurrentPrincipal() principal: Principal): Promise<SessionInfo> {
    return this.auth.info(principal);
  }

  @Post('context')
  @SessionOnly()
  @HttpCode(200)
  async selectContext(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionInfo> {
    const result = await this.auth.selectContext(principal, parseInput(selectContextSchema, body));
    return this.setSession(reply, result);
  }

  @Post('logout')
  @SessionOnly({ allowPendingMfa: true })
  @HttpCode(204)
  async logout(
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(principal);
    void reply.clearCookie(this.cookieName, { path: '/' });
  }

  @Post('mfa/totp/setup')
  @SessionOnly({ allowPendingMfa: true })
  @HttpCode(200)
  totpSetup(@CurrentPrincipal() principal: Principal): Promise<TotpSetup> {
    return this.auth.totpSetup(principal);
  }

  @Post('mfa/totp/enable')
  @SessionOnly({ allowPendingMfa: true })
  @HttpCode(200)
  async totpEnable(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionInfo & { recoveryCodes: string[] }> {
    const { code } = parseInput(totpEnableSchema, body);
    const { result, recoveryCodes } = await this.auth.totpEnable(principal, code);
    return { ...this.setSession(reply, result), recoveryCodes };
  }

  @Post('mfa/verify')
  @SessionOnly({ allowPendingMfa: true })
  @HttpCode(200)
  async mfaVerify(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionInfo> {
    const result = await this.auth.mfaVerify(principal, parseInput(mfaVerifySchema, body));
    return this.setSession(reply, result);
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(202)
  async forgotPassword(@Req() request: FastifyRequest, @Body() body: unknown): Promise<void> {
    const { email } = parseInput(forgotPasswordSchema, body);
    await this.auth.forgotPassword(request.portal!, email);
  }

  @Post('password/reset')
  @Public()
  @HttpCode(204)
  async resetPassword(@Body() body: unknown): Promise<void> {
    const { token, password } = parseInput(resetPasswordSchema, body);
    await this.auth.resetPassword(token, password);
  }

  @Post('invitations/preview')
  @Public()
  @HttpCode(200)
  previewInvitation(@Body() body: unknown): Promise<InvitationPreview> {
    const { token } = parseInput(z.strictObject({ token: invitationTokenSchema }), body);
    return this.invitations.preview(token);
  }

  @Post('invitations/accept')
  @Public()
  @HttpCode(204)
  async acceptInvitation(@Body() body: unknown): Promise<void> {
    const { token, ...input } = parseInput(
      acceptInvitationSchema.extend({ token: invitationTokenSchema }),
      body,
    );
    await this.invitations.accept(token, input);
  }
}
