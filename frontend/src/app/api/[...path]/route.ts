import { NextRequest, NextResponse } from "next/server";

const BACKEND_BASE = (
  process.env.FASTAPI_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:8000"
).replace(/\/$/, "");

function buildTargetUrl(req: NextRequest, path: string[]): string {
  const suffix = path.join("/");
  const hasTrailingSlash = req.nextUrl.pathname.endsWith("/");
  const targetPath = hasTrailingSlash && suffix ? `${suffix}/` : suffix;
  const target = new URL(`${BACKEND_BASE}/${targetPath}`);

  // Preserve query parameters exactly.
  req.nextUrl.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value);
  });

  return target.toString();
}

function rewriteRedirectLocation(location: string): string {
  try {
    const url = new URL(location, BACKEND_BASE);
    const backendUrl = new URL(BACKEND_BASE);
    if (url.origin !== backendUrl.origin) return location;

    const apiPath = url.pathname.startsWith("/")
      ? url.pathname
      : `/${url.pathname}`;
    const backendPrefix =
      backendUrl.pathname === "/" ? "" : backendUrl.pathname.replace(/\/$/, "");

    let normalizedPath = apiPath;
    if (backendPrefix && normalizedPath.startsWith(`${backendPrefix}/`)) {
      normalizedPath = normalizedPath.slice(backendPrefix.length);
    } else if (backendPrefix && normalizedPath === backendPrefix) {
      normalizedPath = "/";
    }

    if (!normalizedPath.startsWith("/")) {
      normalizedPath = `/${normalizedPath}`;
    }

    return `/api${normalizedPath}${url.search}`;
  } catch {
    return location;
  }
}

function backendUnavailableResponse(targetUrl: string): NextResponse {
  return NextResponse.json(
    {
      detail: "Backend service is unavailable. Please retry in a moment.",
      target: targetUrl,
    },
    { status: 503 },
  );
}

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const targetUrl = buildTargetUrl(req, path);

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");

  // Only forward a body when one actually exists. Passing an empty stream for
  // body-less POSTs (e.g. action endpoints) makes the upstream fetch hang.
  const methodCanHaveBody = req.method !== "GET" && req.method !== "HEAD";
  const contentLengthHeader = req.headers.get("content-length");
  const parsedContentLength = contentLengthHeader
    ? Number.parseInt(contentLengthHeader, 10)
    : NaN;
  const hasBody =
    methodCanHaveBody &&
    ((Number.isFinite(parsedContentLength) && parsedContentLength > 0) ||
      req.body !== null);

  const contentType = req.headers.get("content-type") || "";
  const canReplayBody = hasBody && !contentType.includes("multipart/form-data");

  let replayableBody: ArrayBuffer | undefined;
  if (canReplayBody) {
    const bufferedBody = await req.arrayBuffer();
    if (bufferedBody.byteLength > 0) {
      replayableBody = bufferedBody;
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: canReplayBody ? replayableBody : hasBody ? req.body : undefined,
      redirect: "manual",
      ...(!canReplayBody && hasBody ? ({ duplex: "half" } as const) : {}),
    });
  } catch {
    return backendUnavailableResponse(targetUrl);
  }

  if (
    [301, 302, 303, 307, 308].includes(upstream.status) &&
    upstream.headers.has("location")
  ) {
    const rawLocation = upstream.headers.get("location")!;
    const resolvedLocation = new URL(rawLocation, targetUrl).toString();

    // Follow backend canonical redirects inside the proxy whenever we can.
    // This avoids redirect loops surfaced in browsers as "Failed to fetch".
    if (!hasBody || canReplayBody) {
      try {
        upstream = await fetch(resolvedLocation, {
          method: req.method,
          headers,
          body: canReplayBody ? replayableBody : undefined,
          redirect: "manual",
        });
      } catch {
        return backendUnavailableResponse(resolvedLocation);
      }
    } else {
      const location = rewriteRedirectLocation(rawLocation);
      return NextResponse.redirect(new URL(location, req.url), upstream.status);
    }
  }

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("transfer-encoding");
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("connection");

  const noBodyStatus = [204, 205, 304].includes(upstream.status);
  if (noBodyStatus) {
    responseHeaders.delete("content-length");
    responseHeaders.delete("content-type");
    return new NextResponse(null, {
      status: upstream.status,
      headers: responseHeaders,
    });
  }

  // Buffer upstream payload so client-side readers (e.g. res.text/json) always
  // receive a complete body, even when upstream uses chunked transfer.
  const responseBody = await upstream.arrayBuffer();

  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

type Params = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { path } = await params;
  return proxy(req, path);
}

export async function POST(req: NextRequest, { params }: Params) {
  const { path } = await params;
  return proxy(req, path);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { path } = await params;
  return proxy(req, path);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { path } = await params;
  return proxy(req, path);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { path } = await params;
  return proxy(req, path);
}

export async function OPTIONS(req: NextRequest, { params }: Params) {
  const { path } = await params;
  return proxy(req, path);
}
