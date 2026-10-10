/**
 * Where UploadThing sends its upload confirmations.
 *
 * Production and local development keep UploadThing's default: this route's
 * own URL. A Preview sits behind Vercel Authentication, which UploadThing
 * cannot pass, so its confirmations never arrived, no FileAsset was recorded,
 * and every uploaded deliverable was refused at attach ("This file cannot be
 * attached to a product"). A Preview therefore names the TEST relay, which
 * verifies its own Vercel identity and forwards the unchanged confirmation to
 * the Preview's /api/uploadthing (saiflow-geidea-relay, lib/uploadthing-plan).
 * This route still verifies UploadThing's signature before recording
 * anything; the relay only carries the message.
 *
 * Decided by VERCEL_ENV, which Vercel sets and no request can influence.
 * Never a request header.
 */
export const TEST_UPLOAD_CALLBACK_RELAY_URL = "https://project-w5bhm.vercel.app/api/uploadthing-callback";

export function uploadthingCallbackConfig(env: Readonly<Record<string, string | undefined>> = process.env): { callbackUrl?: string } {
  return env.VERCEL_ENV === "preview" ? { callbackUrl: TEST_UPLOAD_CALLBACK_RELAY_URL } : {};
}
