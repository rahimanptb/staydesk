import { NextResponse, type NextRequest } from 'next/server';
import { internalPath, portalForHost } from './portals';

/** Routes each portal host to its own route tree (hotel / agent / admin). */
export function proxy(request: NextRequest): NextResponse {
  const portal = portalForHost(request.headers.get('host'));
  if (!portal) return new NextResponse('Not found', { status: 404 });

  const url = request.nextUrl.clone();
  url.pathname = internalPath(portal, url.pathname);
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
