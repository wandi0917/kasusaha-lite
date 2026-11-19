import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const bucket = "product-photos";
const root = path.resolve("backup/storage");

if (!baseUrl || !serviceKey) {
  throw new Error("SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diatur.");
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
};

async function fetchWithRetry(url, options, label) {
  const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      if (attempt === maxAttempts) {
        throw new Error(`${label} gagal setelah ${maxAttempts} percobaan: ${error.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** (attempt - 1))));
      continue;
    }

    if (response.ok || !retryableStatuses.has(response.status) || attempt === maxAttempts) {
      return response;
    }

    const retryAfter = response.headers.get("retry-after");
    await response.body?.cancel();
    const retrySeconds = retryAfter && /^\d+$/.test(retryAfter)
      ? Math.min(Number(retryAfter), 30)
      : 0;
    const delayMs = retrySeconds > 0
      ? retrySeconds * 1000
      : 1000 * (2 ** (attempt - 1));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`${label} gagal setelah ${maxAttempts} percobaan.`);
}

async function listObjects(prefix, offset) {
  const response = await fetchWithRetry(
    `${baseUrl}/storage/v1/object/list/${bucket}`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        prefix,
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    },
    `Daftar Storage untuk prefix "${prefix}"`,
  );
  if (!response.ok) {
    throw new Error(`Storage list gagal (HTTP ${response.status}) pada prefix "${prefix}".`);
  }
  return response.json();
}

const visited = new Set();
const files = [];

async function walk(prefix = "") {
  if (visited.has(prefix)) return;
  visited.add(prefix);

  let offset = 0;
  while (true) {
    const entries = await listObjects(prefix, offset);
    if (!Array.isArray(entries)) {
      throw new Error("Respons daftar Storage tidak sesuai format.");
    }

    for (const entry of entries) {
      if (
        !entry ||
        typeof entry.name !== "string" ||
        entry.name === "." ||
        entry.name === ".." ||
        entry.name.includes("/") ||
        entry.name.includes("\\") ||
        entry.name.includes("\0")
      ) {
        throw new Error("Nama objek Storage tidak valid; backup dihentikan.");
      }
      const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;

      // Folder entries have no object id; recurse to capture nested objects.
      if (entry.id == null) {
        await walk(objectPath);
      } else {
        files.push(objectPath);
      }
    }

    if (entries.length < 1000) break;
    offset += entries.length;
  }
}

await walk("");

let totalBytes = 0;
for (const objectPath of files) {
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const response = await fetchWithRetry(
    `${baseUrl}/storage/v1/object/${bucket}/${encodedPath}`,
    { headers },
    `Unduhan objek "${objectPath}"`,
  );
  if (!response.ok) {
    throw new Error(`Unduhan objek Storage gagal (HTTP ${response.status}).`);
  }

  const destination = path.resolve(root, ...objectPath.split("/"));
  if (!destination.startsWith(root + path.sep)) {
    throw new Error("Lokasi objek Storage keluar dari folder backup.");
  }

  const data = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, data, { flag: "wx" });
  totalBytes += data.byteLength;
}

console.log(`Storage backup selesai: ${files.length} file, ${totalBytes} byte.`);
