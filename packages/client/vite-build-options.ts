export function manualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;

  if (id.includes("/react/") || id.includes("/react-dom/")) {
    return "vendor-react";
  }
  if (id.includes("/react-router") || id.includes("/react-router-dom")) {
    return "vendor-router";
  }
  if (id.includes("/lucide-react/")) {
    return "vendor-icons";
  }
  if (id.includes("/tssrp6a/") || id.includes("/tweetnacl/")) {
    return "vendor-crypto";
  }
  if (id.includes("/zod/")) {
    return "vendor-zod";
  }

  return "vendor";
}
