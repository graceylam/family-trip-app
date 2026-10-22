interface Env {
  MEDIA_BUCKET: R2Bucket;
  FIREBASE_PROJECT_ID: string;
  MAX_STORAGE_BYTES: string;
}

type Membership = { uid: string; role: "admin" | "contributor" };

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,160}$/;

function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  const allowed = origin === "https://graceylam.github.io"
    || origin === "capacitor://localhost"
    || origin === "https://localhost"
    || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://graceylam.github.io",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-File-Name, X-Media-Access-Key",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(request: Request, value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: cors(request) });
}

function tokenUid(token: string): string {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return "";
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as { sub?: string };
    return String(payload.sub || "");
  } catch {
    return "";
  }
}

async function membership(request: Request, env: Env, tripId: string): Promise<Membership | null> {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const uid = tokenUid(token);
  if (!token || !uid || !ID_PATTERN.test(uid)) return null;
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/trips/${encodeURIComponent(tripId)}/members/${encodeURIComponent(uid)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  const document = await response.json() as { fields?: { role?: { stringValue?: string } } };
  const role = document.fields?.role?.stringValue === "admin" ? "admin" : "contributor";
  return { uid, role };
}

async function storedBytes(bucket: R2Bucket): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    total += page.objects.reduce((sum, object) => sum + object.size, 0);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return total;
}

function mediaKey(tripId: string, mediaId: string, variant: string): string {
  return `trips/${tripId}/media/${mediaId}/${variant}`;
}

function routeParts(pathname: string): { tripId: string; mediaId: string; variant: string } | null {
  const match = pathname.match(/^\/v1\/media\/([^/]+)\/([^/]+)\/(original|display|thumbnail)$/);
  if (!match) return null;
  const [, tripId, mediaId, variant] = match.map((part) => decodeURIComponent(part));
  return ID_PATTERN.test(tripId) && ID_PATTERN.test(mediaId) ? { tripId, mediaId, variant } : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
    const url = new URL(request.url);
    if (url.pathname === "/v1/health") return json(request, { ok: true, provider: "r2", private: true });

    const usageMatch = url.pathname.match(/^\/v1\/usage\/([^/]+)$/);
    if (usageMatch && request.method === "GET") {
      const tripId = decodeURIComponent(usageMatch[1]);
      if (!ID_PATTERN.test(tripId) || !await membership(request, env, tripId)) return json(request, { error: "Not authorised." }, 403);
      const usedBytes = await storedBytes(env.MEDIA_BUCKET);
      return json(request, { usedBytes, limitBytes: Number(env.MAX_STORAGE_BYTES) || 100_000_000_000 });
    }

    const route = routeParts(url.pathname);
    if (!route) return json(request, { error: "Not found." }, 404);
    const key = mediaKey(route.tripId, route.mediaId, route.variant);

    if (request.method === "GET") {
      const accessKey = url.searchParams.get("access") || "";
      const object = await env.MEDIA_BUCKET.get(key);
      if (!object || !accessKey || object.customMetadata?.accessKey !== accessKey) return json(request, { error: "Not found." }, 404);
      const headers = new Headers(cors(request));
      object.writeHttpMetadata(headers);
      headers.set("ETag", object.httpEtag);
      headers.set("Cache-Control", "private, max-age=3600");
      return new Response(object.body, { headers });
    }

    const member = await membership(request, env, route.tripId);
    if (!member) return json(request, { error: "This trip link is not authorised." }, 403);

    if (request.method === "PUT") {
      const size = Number(request.headers.get("Content-Length") || 0);
      const maxFileBytes = 95_000_000;
      if (!size || size > maxFileBytes) return json(request, { error: "Files must be smaller than 95 MB." }, 413);
      const accessKey = request.headers.get("X-Media-Access-Key") || "";
      if (accessKey.length < 32) return json(request, { error: "Invalid media access key." }, 400);
      const previous = await env.MEDIA_BUCKET.head(key);
      const currentBytes = await storedBytes(env.MEDIA_BUCKET);
      const limitBytes = Number(env.MAX_STORAGE_BYTES) || 100_000_000_000;
      if (currentBytes - (previous?.size || 0) + size > limitBytes) {
        return json(request, { error: "The family storage limit has been reached. An admin can remove memories or raise the limit." }, 507);
      }
      await env.MEDIA_BUCKET.put(key, request.body, {
        httpMetadata: { contentType: request.headers.get("Content-Type") || "application/octet-stream" },
        customMetadata: {
          accessKey,
          memberId: member.uid,
          tripId: route.tripId,
          mediaId: route.mediaId,
          fileName: (request.headers.get("X-File-Name") || "memory").slice(0, 240),
        },
      });
      return json(request, { key, size });
    }

    if (request.method === "DELETE") {
      const object = await env.MEDIA_BUCKET.head(key);
      if (!object) return new Response(null, { status: 204, headers: cors(request) });
      if (member.role !== "admin" && object.customMetadata?.memberId !== member.uid) return json(request, { error: "Only the uploader or a trip admin can remove this memory." }, 403);
      await env.MEDIA_BUCKET.delete(key);
      return new Response(null, { status: 204, headers: cors(request) });
    }

    return json(request, { error: "Method not allowed." }, 405);
  },
};
