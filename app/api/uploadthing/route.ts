import { createRouteHandler } from "uploadthing/next";
import { ourFileRouter } from "./core";
import { uploadthingCallbackConfig } from "@/lib/uploadthing-callback";

// Export routes for Next App Router. A Preview's confirmations come through
// the TEST relay: see lib/uploadthing-callback.
export const { GET, POST } = createRouteHandler({
  router: ourFileRouter,
  config: uploadthingCallbackConfig(),
});
