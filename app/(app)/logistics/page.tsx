export const dynamic = "force-dynamic";

import { permanentRedirect } from "next/navigation";

export default function LogisticsIndexPage() {
  permanentRedirect("/logistics/dashboard");
}
