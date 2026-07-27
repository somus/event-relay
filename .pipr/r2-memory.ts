import { S3Client } from "bun";
import { definePlugin, type SecretRef, type TaskContext, z } from "@usepipr/sdk";

export const memoryLimits = {
  subjectCharacters: 120,
  bodyCharacters: 4000,
  tagCount: 12,
  tagCharacters: 50,
  queryCharacters: 500,
  resultDefault: 5,
  resultMinimum: 1,
  resultMaximum: 20,
  searchObjectMaximum: 2000,
} as const;

const memorySource = z.strictObject({
  kind: z.enum(["maintainer-command", "agent-tool"]),
  runId: z.string().min(1).max(200),
  platform: z.string().min(1).max(50),
  changeRequestNumber: z.number().int().nonnegative().optional(),
  headSha: z.string().min(1).max(200),
});

const memoryItem = z.strictObject({
  id: z.string().uuid().optional(),
  subject: z.string().trim().min(1).max(memoryLimits.subjectCharacters),
  body: z.string().trim().min(1).max(memoryLimits.bodyCharacters),
  tags: z
    .array(z.string().trim().min(1).max(memoryLimits.tagCharacters))
    .max(memoryLimits.tagCount)
    .optional(),
  source: memorySource.optional(),
  updatedAt: z.string().max(50).optional(),
});

const memorySearchInput = z.strictObject({
  query: z.string().trim().min(1).max(memoryLimits.queryCharacters),
  limit: z
    .number()
    .int()
    .min(memoryLimits.resultMinimum)
    .max(memoryLimits.resultMaximum)
    .optional(),
});

const memoryStoreInput = z.strictObject({
  subject: z.string().trim().min(1).max(memoryLimits.subjectCharacters),
  body: z.string().trim().min(1).max(memoryLimits.bodyCharacters),
  tags: z
    .array(z.string().trim().min(1).max(memoryLimits.tagCharacters))
    .max(memoryLimits.tagCount)
    .optional(),
});

type MemoryItem = ReturnType<typeof memoryItem.parse>;
type MemorySearchInput = ReturnType<typeof memorySearchInput.parse>;
type MemoryStoreInput = ReturnType<typeof memoryStoreInput.parse>;

export type R2MemoryOptions = {
  bucket: SecretRef;
  endpoint: SecretRef;
  accessKeyId: SecretRef;
  secretAccessKey: SecretRef;
  sessionToken?: SecretRef;
  region?: string;
  prefix?: string;
};

export function r2MemoryPlugin(options: R2MemoryOptions) {
  return definePlugin((pipr) => {
    const searchInput = pipr.schema({
      id: "memory/search-input",
      schema: memorySearchInput,
    });
    const searchOutput = pipr.schema({
      id: "memory/search-output",
      schema: z.strictObject({
        memories: z.array(memoryItem),
        skippedObjects: z.number().int().nonnegative(),
      }),
    });
    const storeInput = pipr.schema({
      id: "memory/store-input",
      schema: memoryStoreInput,
    });
    const storeOutput = pipr.schema({
      id: "memory/store-output",
      schema: z.strictObject({
        stored: z.boolean(),
        key: z.string(),
        id: z.string().uuid(),
      }),
    });

    return {
      search: pipr.tool({
        name: "r2_memory_search",
        description: "Search durable reviewer memory stored in Cloudflare R2.",
        input: searchInput,
        output: searchOutput,
        async run({ input, ctx, signal }) {
          return await searchMemory(input, ctx, options, signal);
        },
        toModelOutput(output) {
          return output;
        },
      }),
      store: pipr.tool({
        name: "r2_memory_store",
        description: "Store reusable, non-sensitive reviewer memory in Cloudflare R2.",
        input: storeInput,
        output: storeOutput,
        async run({ input, ctx, signal }) {
          return await storeMemory(input, ctx, options, "agent-tool", signal);
        },
        toModelOutput(output) {
          return output;
        },
      }),
      curate(input: MemoryStoreInput, ctx: TaskContext, signal?: AbortSignal) {
        return storeMemory(input, ctx, options, "maintainer-command", signal);
      },
    };
  });
}

async function searchMemory(
  input: MemorySearchInput,
  ctx: TaskContext,
  options: R2MemoryOptions,
  signal?: AbortSignal,
): Promise<{ memories: MemoryItem[]; skippedObjects: number }> {
  signal?.throwIfAborted();
  const bucket = r2Bucket(ctx, options);
  const memories: MemoryItem[] = [];
  let continuationToken: string | undefined;
  let scannedObjects = 0;
  let skippedObjects = 0;

  do {
    signal?.throwIfAborted();
    const listed = await bucket.list({
      prefix: memoryPrefix(ctx, options) + "/",
      maxKeys: 200,
      continuationToken,
    });

    const objects = (listed.contents ?? []).slice(
      0,
      memoryLimits.searchObjectMaximum - scannedObjects,
    );
    scannedObjects += objects.length;
    for (const object of objects) {
      signal?.throwIfAborted();
      try {
        const value = memoryItem.parse(await bucket.file(object.key).json());
        if (matchesMemory(value, input.query)) {
          memories.push(value);
        }
      } catch {
        // Exclude malformed or concurrently deleted objects and report the count.
        skippedObjects += 1;
      }
    }

    continuationToken = listed.isTruncated ? listed.nextContinuationToken : undefined;
  } while (continuationToken && scannedObjects < memoryLimits.searchObjectMaximum);

  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? memoryLimits.resultDefault), memoryLimits.resultMinimum),
    memoryLimits.resultMaximum,
  );
  return {
    memories: memories
      .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
      .slice(0, limit),
    skippedObjects,
  };
}

async function storeMemory(
  input: MemoryStoreInput,
  ctx: TaskContext,
  options: R2MemoryOptions,
  sourceKind: "maintainer-command" | "agent-tool",
  signal?: AbortSignal,
): Promise<{ stored: boolean; key: string; id: string }> {
  signal?.throwIfAborted();
  const bucket = r2Bucket(ctx, options);
  const parsedInput = memoryStoreInput.parse(input);
  const curatedKey =
    sourceKind === "maintainer-command"
      ? memoryPrefix(ctx, options) +
        "/maintainer-command/" +
        encodeURIComponent(ctx.run.id) +
        ".json"
      : undefined;

  const id = curatedKey ? await stableCommandMemoryId(ctx.run.id) : crypto.randomUUID();
  const entry = memoryItem.parse({
    ...parsedInput,
    id,
    source: {
      kind: sourceKind,
      runId: ctx.run.id,
      platform: ctx.platform.id,
      changeRequestNumber: ctx.change.number,
      headSha: ctx.change.head.sha,
    },
    updatedAt: new Date().toISOString(),
  });
  const key = curatedKey ?? memoryKey(id, parsedInput.subject, ctx, options);
  await bucket.write(key, JSON.stringify(entry, null, 2), { type: "application/json" });
  return { stored: true, key, id };
}

async function stableCommandMemoryId(runId: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("pipr-memory/maintainer-command/" + runId),
    ),
  );
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join(
    "-",
  );
}

function r2Bucket(ctx: TaskContext, options: R2MemoryOptions): S3Client {
  return new S3Client({
    bucket: ctx.secret(options.bucket),
    endpoint: ctx.secret(options.endpoint),
    accessKeyId: ctx.secret(options.accessKeyId),
    secretAccessKey: ctx.secret(options.secretAccessKey),
    region: options.region ?? "auto",
    sessionToken: options.sessionToken ? ctx.secret(options.sessionToken) : undefined,
  });
}

function memoryPrefix(ctx: TaskContext, options: R2MemoryOptions): string {
  return cleanPathSegment(options.prefix ?? "pipr-memory") + "/" + repositoryScope(ctx);
}

function repositoryScope(ctx: TaskContext): string {
  return cleanPathSegment([ctx.repository.owner, ctx.repository.name].filter(Boolean).join("/"));
}

function cleanPathSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9/_-]+/g, "-")
      .replace(/^\/+|\/+$/g, "") || "pipr-memory"
  );
}

function memoryKey(
  id: string,
  subject: string,
  ctx: TaskContext,
  options: R2MemoryOptions,
): string {
  const slug = subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return (
    memoryPrefix(ctx, options) +
    "/" +
    new Date().toISOString() +
    "-" +
    id +
    "-" +
    (slug || "memory") +
    ".json"
  );
}

function matchesMemory(item: MemoryItem, query: string): boolean {
  const haystack = [item.subject, item.body, ...(item.tags ?? [])].join("\n").toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9/_-]+/g)
    .filter((term) => term.length >= 3)
    .slice(0, 40);
  return terms.length === 0 || terms.some((term) => haystack.includes(term));
}
