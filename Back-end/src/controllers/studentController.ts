import { prisma } from "../lib/prisma";

export async function getAvailableRoutes(req, res) {
  const user = req.user;

  if (user.role !== "student") {
    return res.status(403).json({ error: "Apenas alunos podem consultar rotas disponíveis" });
  }

  if (!user.cityId) {
    return res.status(403).json({ error: "Usuário sem cidade definida" });
  }

  const routes = await prisma.transportRoute.findMany({
    where: {
      active: true,
      cityId: user.cityId,
      schedule: { active: true },
    },
    include: {
      city: true,
      schedule: { include: { university: true } },
      vehicle: true,
      driver: { select: { id: true, nome: true, email: true } },
      points: {
        where: {
          pickupPoint: {
            is: {
              active: true,
              cityId: user.cityId,
            },
          },
        },
        include: { pickupPoint: { include: { university: true, city: true } } },
        orderBy: { order: "asc" },
      },
      reservations: { where: { status: "confirmed" }, select: { id: true } },
    },
    orderBy: [{ schedule: { time: "asc" } }, { name: "asc" }],
  });

  return res.json(routes);
}

export async function getStudentsByRoute(req, res) {
  const { routeId } = req.params;
  const user = req.user;
  const allowedCities = req.allowedCities ?? (user?.cityId ? [user.cityId] : []);

  const route = await prisma.transportRoute.findUnique({ where: { id: Number(routeId) } });
  if (!route || !allowedCities.includes(route.cityId)) {
    return res.status(404).json({ error: "Rota não encontrada para sua cidade" });
  }

  const reservations = await prisma.reservation.findMany({
    where: {
      routeId: Number(routeId),
      status: "confirmed",
    },
    include: { user: { include: { city: true } }, pickupPoint: true },
  });

  const grouped = {};
  reservations.forEach((r) => {
    const city = r.user.city?.name ?? "Cidade não informada";
    if (!grouped[city]) grouped[city] = [];
    grouped[city].push({
      id: r.user.id,
      nome: r.user.nome,
      institution: r.user.institution,
      cidade: r.user.city,
      ponto: r.pickupPoint?.name,
    });
  });

  return res.json(grouped);
}

export async function getMyTripPassengers(req, res) {
  const user = req.user;

  if (!user?.cityId) return res.status(403).json({ error: "Usuário sem cidade definida" });

  const requestedRouteId = req.query?.routeId ? Number(req.query.routeId) : null;
  const requestedDay = typeof req.query?.dayOfWeek === "string" ? req.query.dayOfWeek : null;
  const requestedType = req.query?.type === "ida" || req.query?.type === "volta" ? req.query.type : null;

  if (req.query?.routeId && (!Number.isInteger(requestedRouteId) || Number(requestedRouteId) <= 0)) {
    return res.status(400).json({ error: "Rota inválida" });
  }

  const ownReservations = await prisma.reservation.findMany({
    where: {
      userId: user.id,
      status: "confirmed",
      ...(requestedRouteId ? { routeId: requestedRouteId } : {}),
      ...(requestedDay ? { dayOfWeek: requestedDay } : {}),
      route: {
        cityId: user.cityId,
        ...(requestedType ? { schedule: { type: requestedType } } : {}),
      },
    },
    select: { routeId: true, dayOfWeek: true },
  });

  if (!ownReservations.length) return res.json([]);

  const routeIds = Array.from(new Set(ownReservations.map((reservation) => reservation.routeId)));
  const allowedTripKeys = new Set(
    ownReservations.map((reservation) => `${reservation.routeId}:${reservation.dayOfWeek ?? ""}`),
  );

  const passengers = await prisma.reservation.findMany({
    where: {
      routeId: { in: routeIds },
      status: "confirmed",
      ...(requestedDay ? { dayOfWeek: requestedDay } : {}),
    },
    include: {
      user: { include: { city: true } },
      pickupPoint: true,
      route: { include: { schedule: true } },
    },
    orderBy: [{ routeId: "asc" }, { user: { nome: "asc" } }],
  });

  const unique = new Map<string, any>();
  for (const passenger of passengers) {
    const tripKey = `${passenger.routeId}:${passenger.dayOfWeek ?? ""}`;
    if (!allowedTripKeys.has(tripKey)) continue;
    if (requestedType && passenger.route.schedule.type !== requestedType) continue;

    const key = `${passenger.userId}:${tripKey}`;
    if (unique.has(key)) continue;
    unique.set(key, {
      nome: passenger.user.nome,
      instituicao: passenger.user.institution,
      cidade: passenger.user.city?.name,
      uf: passenger.user.city?.state,
      ponto: passenger.pickupPoint?.name,
      routeId: passenger.routeId,
      dayOfWeek: passenger.dayOfWeek,
      type: passenger.route.schedule.type,
    });
  }

  return res.json(Array.from(unique.values()));
}
