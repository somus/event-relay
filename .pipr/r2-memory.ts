import { S3Client } from "bun";
import { definePlugin, type SecretRef, type TaskContext, z } from "@usepipr/sdk";

const memoryItem = z.strictObject({
  subject: z.string(),
  body: z.string(),
  tags: z.array(z.string()).optional(),
  updatedAt: z.string().optional(),
});

const memorySearchInput = z.strictObject({
  query: z.string(),
  limit: z.number().optional(),
});

const memoryStoreInput = z.strictObject({
  subject: z.string(),
  body: z.string(),
  tags: z.array(z.string()).optional(),
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
          return await storeMemory(input, ctx, options, signal);
        },
        toModelOutput(output) {
          return output;
        },
      }),
    };
  });
}

async function searchMemory(
  input: MemorySearchInput,
  ctx: TaskContext,
  options: R2MemoryOptions,
  signal?: AbortSignal,
): Promise<{ memories: MemoryItem[] }> {
  signal?.throwIfAborted();
  const bucket = r2Bucket(ctx, options);
  const listed = await bucket.list({ prefix: memoryPrefix(ctx, options) + "/", maxKeys: 200 });
  const memories: MemoryItem[] = [];

  for (const object of listed.contents ?? []) {
    signal?.throwIfAborted();
    try {
      const value = memoryItem.parse(await bucket.file(object.key).json());
      if (matchesMemory(value, input.query)) {
        memories.push(value);
      }
    } catch {
      // Ignore malformed or concurrently deleted memory objects.
    }
  }

  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 5), 1), 20);
  return {
    memories: memories
      .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
      .slice(0, limit),
  };
}

async function storeMemory(
  input: MemoryStoreInput,
  ctx: TaskContext,
  options: R2MemoryOptions,
  signal?: AbortSignal,
): Promise<{ stored: boolean; key: string }> {
  signal?.throwIfAborted();
  const bucket = r2Bucket(ctx, options);
  const entry: MemoryItem = { ...input, updatedAt: new Date().toISOString() };
  const key = memoryKey(input.subject, ctx, options);
  await bucket.write(key, JSON.stringify(entry, null, 2), { type: "application/json" });
  return { stored: true, key };
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

function memoryKey(subject: string, ctx: TaskContext, options: R2MemoryOptions): string {
  const slug = subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return (
    memoryPrefix(ctx, options) + "/" + new Date().toISOString() + "-" + (slug || "memory") + ".json"
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
