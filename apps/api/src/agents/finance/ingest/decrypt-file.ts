import { spawn } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join, dirname, basename, extname } from "node:path";
import { tmpdir } from "node:os";

/**
 * Decryption errors the caller might want to distinguish:
 *  - WrongPasswordError: file is encrypted, but the password didn't work.
 *    The user should retry with a different password.
 *  - EncryptionUnsupportedError: file is encrypted with a scheme we can't
 *    handle (rare — qpdf handles every PDF variant, officecrypto handles
 *    Office 2007+, node-stream-zip handles standard zip). Surface to user.
 */
export class WrongPasswordError extends Error {
  constructor(message = "Incorrect password") {
    super(message);
    this.name = "WrongPasswordError";
  }
}

export class EncryptionUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionUnsupportedError";
  }
}

export type EncryptedKind = "pdf" | "xlsx" | "zip";

/**
 * Quick header-bytes check: is this file encrypted?
 *
 * Why: validateUpload reads file → sends to Claude. Claude either succeeds
 * (file is readable) or fails. We need to distinguish "file is encrypted"
 * from "Claude couldn't parse it" early so we surface the right UX (ask
 * for password vs. mark as not-a-statement).
 *
 * Detection strategy:
 *  - PDF: read header + check /Encrypt dict in the first ~4 KB. qpdf can
 *    also tell us authoritatively via `qpdf --requires-password`.
 *  - XLSX (Office 2007+ AES-128 encrypted): the file is actually a CFB
 *    compound document (starts with 0xD0 0xCF 0x11 0xE0). Unencrypted
 *    .xlsx is a plain zip (starts with PK\x03\x04).
 *  - ZIP: PK\x03\x04 header + encryption flag bit in the local file header.
 *
 * Returns the encrypted kind, or null if unencrypted / unsupported.
 */
export async function detectEncryption(
  filePath: string,
): Promise<EncryptedKind | null> {
  const head = await readFile(filePath).then((b) => b.subarray(0, 4096));

  // PDF — header "%PDF" and an /Encrypt entry in the trailer.
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
    // Definitive check: ask qpdf. Cheap (just reads the trailer).
    return (await pdfRequiresPassword(filePath)) ? "pdf" : null;
  }

  // XLSX-encrypted: Compound File Binary (CFB) format, magic D0 CF 11 E0.
  if (
    head[0] === 0xd0 &&
    head[1] === 0xcf &&
    head[2] === 0x11 &&
    head[3] === 0xe0
  ) {
    return "xlsx";
  }

  // ZIP — PK\x03\x04 + general-purpose bit-flag 0 (encryption) set.
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    // Local file header bit-flag at offset 6 (2 bytes, little-endian).
    // Bit 0 = encrypted.
    const flag = head.readUInt16LE(6);
    if (flag & 0x0001) return "zip";
  }

  return null;
}

/**
 * Try-unlock entry point. Detects encryption, dispatches to the right
 * decryptor, returns the path to a decrypted file (in tmpdir). The caller
 * should treat the decrypted path as ephemeral and delete it after use.
 *
 * Returns null if the file isn't encrypted (no action needed).
 */
export async function decryptIfEncrypted(
  filePath: string,
  password: string,
): Promise<{ kind: EncryptedKind; decryptedPath: string } | null> {
  const kind = await detectEncryption(filePath);
  if (!kind) return null;

  switch (kind) {
    case "pdf":
      return { kind, decryptedPath: await decryptPdf(filePath, password) };
    case "xlsx":
      return { kind, decryptedPath: await decryptXlsx(filePath, password) };
    case "zip":
      return { kind, decryptedPath: await decryptZip(filePath, password) };
  }
}

// ─── PDF (qpdf) ───────────────────────────────────────────────────

async function pdfRequiresPassword(filePath: string): Promise<boolean> {
  // qpdf --requires-password exits 0 if encrypted (needs pw), 2 if not.
  const code = await runQpdf(["--requires-password", filePath], {
    expectStderr: true,
  });
  return code === 0;
}

async function decryptPdf(filePath: string, password: string): Promise<string> {
  const outPath = ephemeralOutputPath(filePath, ".pdf");
  // qpdf decrypts in-place writes by emitting a new file with --decrypt.
  // Exit codes:
  //   0  success
  //   2  invalid password (also: file not encrypted)
  //   3  warnings (still produces output — treat as success)
  const code = await runQpdf([
    `--password=${password}`,
    "--decrypt",
    filePath,
    outPath,
  ]);
  if (code === 0 || code === 3) return outPath;
  // qpdf 12.x emits "invalid password" to stderr with exit 2. Treat as
  // wrong password.
  throw new WrongPasswordError();
}

function runQpdf(
  args: string[],
  opts: { expectStderr?: boolean } = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("qpdf", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new EncryptionUnsupportedError(
            "qpdf is not installed. Run `brew install qpdf` (mac) or add to nixpacks (Railway).",
          ),
        );
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (!opts.expectStderr && code !== 0 && code !== 3 && stderr) {
        // Surface qpdf's exact error for non-password failures so we
        // don't mislabel them as WrongPasswordError.
        if (!/invalid password/i.test(stderr)) {
          reject(new EncryptionUnsupportedError(stderr.trim()));
          return;
        }
      }
      resolve(code ?? 1);
    });
  });
}

// ─── XLSX (officecrypto-tool) ─────────────────────────────────────

async function decryptXlsx(
  filePath: string,
  password: string,
): Promise<string> {
  // officecrypto-tool ships CommonJS without types; dynamic import keeps
  // tsc happy without a separate @types shim.
  const officecrypto = (await import("officecrypto-tool")) as unknown as {
    default?: {
      decrypt: (buf: Buffer, opts: { password: string }) => Promise<Buffer>;
    };
    decrypt?: (buf: Buffer, opts: { password: string }) => Promise<Buffer>;
  };
  const decrypt = officecrypto.default?.decrypt ?? officecrypto.decrypt;
  if (!decrypt) {
    throw new EncryptionUnsupportedError(
      "officecrypto-tool did not export `decrypt`",
    );
  }
  const input = await readFile(filePath);
  let output: Buffer;
  try {
    output = await decrypt(input, { password });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (/password|invalid/i.test(msg)) throw new WrongPasswordError();
    throw new EncryptionUnsupportedError(`xlsx decrypt failed: ${msg}`);
  }
  const outPath = ephemeralOutputPath(filePath, ".xlsx");
  await writeFile(outPath, output);
  return outPath;
}

// ─── ZIP (node-stream-zip) — extracts the first contained file ─────

async function decryptZip(filePath: string, password: string): Promise<string> {
  // node-stream-zip is CJS; dynamic import + cast.
  const StreamZipMod = (await import("node-stream-zip")) as unknown as {
    default?: new (opts: {
      file: string;
      password?: string;
    }) => StreamZipInstance;
  };
  const StreamZip = StreamZipMod.default;
  if (!StreamZip) {
    throw new EncryptionUnsupportedError(
      "node-stream-zip did not export a default constructor",
    );
  }
  const zip = new StreamZip({ file: filePath, password });
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("ready", () => resolve());
      zip.on("error", reject);
    });
    const entries = Object.values(zip.entries()).filter((e) => !e.isDirectory);
    if (entries.length === 0) {
      throw new EncryptionUnsupportedError("zip is empty");
    }
    // We expect one statement per upload — extract the first file. Pick
    // the largest (most likely the actual data) if multiple exist.
    const target = entries.sort((a, b) => b.size - a.size)[0];
    const outPath = ephemeralOutputPath(filePath, extname(target.name) || ".csv");
    await new Promise<void>((resolve, reject) => {
      zip.extract(target.name, outPath, (err) =>
        err ? reject(err) : resolve(),
      );
    });
    return outPath;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (/password|wrong|invalid/i.test(msg)) throw new WrongPasswordError();
    throw new EncryptionUnsupportedError(`zip decrypt failed: ${msg}`);
  } finally {
    try {
      await zip.close();
    } catch {
      /* noop */
    }
  }
}

interface StreamZipInstance {
  on(event: "ready", cb: () => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  entries(): Record<
    string,
    { name: string; size: number; isDirectory: boolean }
  >;
  extract(
    entry: string,
    outPath: string,
    cb: (err: Error | null) => void,
  ): void;
  close(): Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────

function ephemeralOutputPath(originalPath: string, ext: string): string {
  const stem = basename(originalPath, extname(originalPath));
  return join(
    dirname(originalPath) || tmpdir(),
    `${stem}-decrypted-${Date.now()}${ext}`,
  );
}

/**
 * Best-effort cleanup of a decrypted file. Safe to call in a finally block
 * — never throws.
 */
export async function deleteDecryptedFile(path: string | null): Promise<void> {
  if (!path) return;
  try {
    await unlink(path);
  } catch {
    /* file may already be gone */
  }
}
