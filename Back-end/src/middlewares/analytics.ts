import { prisma } from "../lib/prisma";

type MetadataFactory = (req: any, res: any) => Record<string, unknown> | undefined;

export function trackAnalytics(event: string, metadataFactory?: MetadataFactory) {
  return function analyticsMiddleware(req, res, next) {
    res.on("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 400) return;

      const userId = typeof req.user?.id === "number" ? req.user.id : null;
      const baseMetadata: Record<string, unknown> = {
        role: req.user?.role ?? undefined,
        cityId: req.user?.cityId ?? undefined,
        method: req.method,
      };
      const extra = metadataFactory?.(req, res) ?? {};
      const metadata = Object.fromEntries(
        Object.entries({ ...baseMetadata, ...extra }).filter(([, value]) => value !== undefined && value !== null && value !== ""),
      );

      void prisma.analyticsEvent.create({
        data: {
          userId,
          event,
          metadata,
        },
      }).catch((error) => {
        console.error("Falha ao registrar evento de analytics", { event, error });
      });
    });

    next();
  };
}
