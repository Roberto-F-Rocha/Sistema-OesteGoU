import { prisma } from "../lib/prisma";
import { createAuditLog, getRequestAuditData } from "../utils/audit";

function allowedCityIds(req): number[] {
  return req.allowedCities ?? (req.user?.cityId ? [req.user.cityId] : []);
}

function parseOptionalId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeType(value: unknown): "ida" | "volta" {
  return value === "volta" ? "volta" : "ida";
}

function validTime(value: unknown) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function parsePointIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const parsed: number[] = [];
  for (const item of value) {
    const id = parseOptionalId(item);
    if (id !== null && !parsed.includes(id)) parsed.push(id);
  }
  return parsed;
}

async function validateBundle(req, existingRouteId?: number) {
  const cityIds = allowedCityIds(req);
  const cityId = parseOptionalId(req.body?.cityId) ?? req.user.cityId;
  const universityId = parseOptionalId(req.body?.universityId);
  const driverId = parseOptionalId(req.body?.driverId);
  const vehicleId = parseOptionalId(req.body?.vehicleId);
  const type = normalizeType(req.body?.type);
  const time = req.body?.time;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const pointIds = parsePointIds(req.body?.pointIds);

  if (!cityId || !cityIds.includes(cityId)) throw new Error("Cidade não permitida");
  if (!name) throw new Error("Nome da rota é obrigatório");
  if (!validTime(time)) throw new Error("Horário inválido; use HH:MM");
  if (type === "volta" && !universityId) throw new Error("Universidade é obrigatória para rotas de volta");

  const [city, university, driver, vehicle, points] = await Promise.all([
    prisma.city.findUnique({ where: { id: cityId } }),
    universityId ? prisma.university.findUnique({ where: { id: universityId } }) : Promise.resolve(null),
    driverId ? prisma.user.findUnique({ where: { id: driverId } }) : Promise.resolve(null),
    vehicleId ? prisma.vehicle.findUnique({ where: { id: vehicleId } }) : Promise.resolve(null),
    pointIds.length ? prisma.pickupPoint.findMany({ where: { id: { in: pointIds } } }) : Promise.resolve([]),
  ]);

  if (!city) throw new Error("Cidade não encontrada");
  if (universityId && (!university || university.cityId !== cityId)) throw new Error("Universidade não pertence à cidade da rota");
  if (driverId && (!driver || driver.role !== "driver" || driver.cityId !== cityId || driver.status !== "active")) {
    throw new Error("Motorista precisa estar ativo e pertencer à cidade da rota");
  }
  if (vehicleId && (!vehicle || vehicle.cityId !== cityId || !vehicle.active)) {
    throw new Error("Veículo precisa estar ativo e pertencer à cidade da rota");
  }
  if (points.length !== pointIds.length) throw new Error("Um ou mais pontos não foram encontrados");

  for (const point of points) {
    if (point.cityId !== cityId) throw new Error(`O ponto “${point.name}” pertence a outra cidade`);
    if (!point.active) throw new Error(`O ponto “${point.name}” está inativo`);
    if (point.type !== type) throw new Error(`O ponto “${point.name}” não é compatível com ${type}`);
    if (type === "volta" && universityId && point.universityId !== universityId) {
      throw new Error(`O ponto “${point.name}” não pertence à universidade selecionada`);
    }
  }

  if (existingRouteId) {
    const current = await prisma.transportRoute.findUnique({ where: { id: existingRouteId } });
    if (!current || !cityIds.includes(current.cityId)) throw new Error("Rota não encontrada para suas cidades autorizadas");
  }

  return { cityId, universityId, driverId, vehicleId, type, time, name, pointIds, active: req.body?.active !== false };
}

const includeRoute = {
  city: true,
  schedule: { include: { university: true } },
  vehicle: true,
  driver: { select: { id: true, nome: true, email: true, phone: true, status: true } },
  points: {
    include: { pickupPoint: { include: { university: true, city: true } } },
    orderBy: { order: "asc" as const },
  },
};

export async function createRouteBundle(req, res) {
  try {
    const input = await validateBundle(req);

    const route = await prisma.$transaction(async (tx) => {
      const schedule = await tx.schedule.create({
        data: {
          time: input.time,
          type: input.type,
          universityId: input.universityId ?? undefined,
          active: input.active,
        },
      });

      return tx.transportRoute.create({
        data: {
          name: input.name,
          cityId: input.cityId,
          scheduleId: schedule.id,
          driverId: input.driverId ?? undefined,
          vehicleId: input.vehicleId ?? undefined,
          active: input.active,
          points: input.pointIds.length
            ? { create: input.pointIds.map((pickupPointId, index) => ({ pickupPointId, order: index + 1 })) }
            : undefined,
        },
        include: includeRoute,
      });
    });

    await createAuditLog({
      userId: req.user.id,
      cityId: req.user.cityId,
      action: "create",
      entity: "TransportRoute",
      entityId: route.id,
      description: "Rota e horário cadastrados em operação única",
      metadata: { pointIds: input.pointIds, driverId: input.driverId, vehicleId: input.vehicleId },
      ...getRequestAuditData(req, res),
    });

    return res.status(201).json(route);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Não foi possível criar a rota" });
  }
}

export async function updateRouteBundle(req, res) {
  const routeId = parseOptionalId(req.params.id);
  if (!routeId) return res.status(400).json({ error: "ID inválido" });

  try {
    const input = await validateBundle(req, routeId);
    const current = await prisma.transportRoute.findUnique({ where: { id: routeId } });
    if (!current) return res.status(404).json({ error: "Rota não encontrada" });

    const route = await prisma.$transaction(async (tx) => {
      await tx.schedule.update({
        where: { id: current.scheduleId },
        data: {
          time: input.time,
          type: input.type,
          universityId: input.universityId,
          active: input.active,
        },
      });

      await tx.routePoint.deleteMany({ where: { routeId } });
      if (input.pointIds.length) {
        await tx.routePoint.createMany({
          data: input.pointIds.map((pickupPointId, index) => ({ routeId, pickupPointId, order: index + 1 })),
        });
      }

      await tx.transportRoute.update({
        where: { id: routeId },
        data: {
          name: input.name,
          cityId: input.cityId,
          driverId: input.driverId,
          vehicleId: input.vehicleId,
          active: input.active,
        },
      });

      return tx.transportRoute.findUniqueOrThrow({ where: { id: routeId }, include: includeRoute });
    });

    await createAuditLog({
      userId: req.user.id,
      cityId: req.user.cityId,
      action: "update",
      entity: "TransportRoute",
      entityId: routeId,
      description: "Rota e horário atualizados em operação única",
      metadata: { pointIds: input.pointIds, driverId: input.driverId, vehicleId: input.vehicleId },
      ...getRequestAuditData(req, res),
    });

    return res.json(route);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Não foi possível atualizar a rota" });
  }
}
