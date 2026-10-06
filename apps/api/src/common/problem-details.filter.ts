import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { toProblem } from './problem-details.js';

/** Single exit point for errors: every failure becomes application/problem+json. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const { status, body, unexpected } = toProblem(exception, request.id);
    if (unexpected) {
      request.log.error({ err: exception }, 'Unhandled error');
    } else if (status >= 500) {
      request.log.warn({ code: body.code }, body.title);
    }

    void reply.status(status).header('content-type', 'application/problem+json').send(body);
  }
}
