/**
 * Whether an upload error is the client refusing the file's TYPE.
 *
 * UploadThing's matcher (`@uploadthing/shared` `matchFileType`) fails with
 * `InvalidFileType` when the declared MIME type, or the extension fallback,
 * is not in the route config, and with `UnknownFileType` when it cannot name
 * one. Both surface to `onUploadError` as an Error whose message names the
 * problem in English. The pages use this to show a translated sentence that
 * says which types are accepted, instead of "Upload failed: Invalid file
 * type". Pure and client-safe; it reads the message, never the file.
 */
export function isFileTypeRefusal(error: { message?: string; code?: string } | null | undefined): boolean {
  const message = error?.message ?? "";
  return /invalid file type|could not determine type|file type .* not allowed/i.test(message);
}
