import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createAuditLog, getRequestAuditData } from "../utils/audit";

function allowedCityIds(req): number[] {
  return req.allowedCities ?? (req.user?.cityId ? [req.user.cityId] : []);
}

function parseId(value: unknown) {
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

async function validateUniversity(universityId: number | null, cityIds: number[], selectedCityId?: number) {
  if (!universityId) return null;
  const university = await prisma.university.findUnique({ where: { id: universityId } });
  if (!university || !university.cityId || !cityIds.includes(university.cityId)) {
    throw new Error("Universidade não pertence às cidades autorizadas");
  }
  if (selectedCityId && university.cityId !== selectedCityId) {
    throw new Error("Universidade deve pertencer à mesma cidade da rota");
  }
  return university;
}

async function validateVehicle(vehicleId: number | null, cityId: number) {
  if (!vehicleId) return null;
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle || vehicle.cityId !== cityId) throw new Error("Veículo não pertence à cidade da rota");
  if (!vehicle.active) throw new Error("Veículo está inativo");
  return vehicle;
}

async function validateDriver(driverId: number | null, cityId: number) {
  if (!driverId) return null;
  const driver = await prisma.user.findUnique({ where: { id: driverId } });
  if (!driver || driver.role !== "driver" || driver.cityId !== cityId) {
    throw new Error("Motorista não pertence à cidade da rota");
  }
  if (driver.status !== "active") throw new Error("Motorista não está ativo");
  return driver;
}

async function validatePoints(pointIds: number[], cityId: number, type: "ida" | "volta", universityId: number | null) {
  const uniqueIds = Array.from(new Set(pointIds));
  if (uniqueIds.length === 0) return [];

  const points = await prisma.pickupPoint.findMany({ where: { id: { in: uniqueIds } } });
  if (points.length !== uniqueIds.length) throw new Error("Um ou mais pontos de embarque não foram encontrados");

  for (const point of points) {
    if (point.cityId !== cityId) throw new Error(`O ponto “${point.name}” pertence a outra cidade`);
    if (!point.active) throw new Error(`O ponto “${point.name}” está inativo`);
    if (point.type !== type) throw new Error(`O ponto “${point.name}” não é compatível com o tipo ${type}`);
    if (type === "volta" && universityId && point.universityId !== universityId) {
      throw new Error(`O ponto “${point.name}” não pertence à universidade da rota`);
    }
  }

  return uniqueIds;
}

const routeInclude = {
  city: true,
  schedule: { include: { university: true } },
  vehicle: true,
  driver: { select: { id: true, nome: true, email: true, phone: true, status: true } },
  points: {
    include: { pickupPoint: { include: { university: true, city: true } } },
    orderBy: { order: "asc" as const },
  },
  reservations: { where: { status: "confirmed" as const }, select: { id: true } },
};

export async function listSchedules(req, res) {
  const cityIds = allowedCityIds(req);
  const schedules = await prisma.schedule.findMany({
    where: { routes: { some: { cityId: { in: cityIds } } } },
    include: { university: true },
    orderBy: { time: "asc" },
  });
  return res.json(schedules);
}

export async function createSchedule(req, res) {
  const cityIds = allowedCityIds(req);
  const { time, type } = req.body ?? {};
  const universityId = parseId(req.body?.universityId);

  if (!validTime(time)) return res.status(400).json({ error: "Horário inválido; use HH:MM" });
  if (req.body?.universityId && !universityId) return res.status(400).json({ error: "Universidade inválida" });

  try {
    await validateUniversity(universityId, cityIds);
    const schedule = await prisma.schedule.create({
      data: { time, type: normalizeType(type), universityId: universityId ?? undefined },
      include: { university: true },
    });

    await createAuditLog({
      userId: req.user.id,
      cityId: req.user.cityId,
      action: "create",
      entity: "Schedule",
      entityId: schedule.id,
      description: "Horário cadastrado",
      metadata: { time, type: schedule.type, universityId },
      ...getRequestAuditData(req, res),
    });

    return res.status(201).json(schedule);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Não foi possível criar o horário" });
  }
}

export async function updateSchedule(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const cityIds = allowedCityIds(req);

  const schedule = await prisma.schedule.findUnique({
    where: { id },
    include: { routes: { select: { cityId: true } } },
  });
  if (!schedule || schedule.routes.length === 0 || !schedule.routes.some((route) => cityIds.includes(route.cityId))) {
    return res.status(404).json({ error: "Horário não encontrado para suas cidades autorizadas" });
  }
  if (schedule.routes.some((route) => !cityIds.includes(route.cityId))) {
    return res.status(409).json({ error: "Este horário é compartilhado com uma cidade fora do seu escopo e não pode ser alterado" });
  }

  const universityId = req.body?.universityId === undefined ? schedule.universityId : parseId(req.body.universityId);
  if (req.body?.universityId && !universityId) return res.status(400).json({ error: "Universidade inválida" });
  if (req.body?.time !== undefined && !validTime(req.body.time)) return res.status(400).json({ error: "Horário inválido; use HH:MM" });

  try {
    await validateUniversity(universityId, cityIds);
    const updated = await prisma.schedule.update({
      where: { id },
      data: {
        time: req.body?.time,
        type: req.body?.type === undefined ? undefined : normalizeType(req.body.type),
        universityId,
        active: req.body?.active,
      },
      include: { university: true },
    });

    await createAuditLog({
      userId: req.user.id,
      cityId: req.user.cityId,
      action: "update",
      entity: "Schedule",
      entityId: id,
      description: "Horário atualizado",
      ...getRequestAuditData(req, res),
    });
    return res.json(updated);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Não foi possível atualizar o horário" });
  }
}

export async function listRoutes(req, res) {
  const cityIds = allowedCityIds(req);
  const routes = await prisma.transportRoute.findMany({
    where: { cityId: { in: cityIds } },
    include: routeInclude,
    orderBy: { createdAt: "desc" },
  });
  return res.json(routes);
}

async function validateRouteRelations(input: {
  cityId: number;
  scheduleId: number;
  vehicleId: number | null;
  driverId: number | null;
  pointIds: number[];
}, allowedCities: number[]) {
  if (!allowedCities.includes(input.cityId)) throw new Error("Cidade não permitida");
  const schedule = await prisma.schedule.findUnique({ where: { id: input.scheduleId }, include: { university: true } });
  if (!schedule) throw new Error("Horário não encontrado");
  if (!schedule.active) throw new Error("Horário está inativo");
  if (schedule.universityId) await validateUniversity(schedule.universityId, allowedCities, input.cityId);
  await Promise.all([validateVehicle(input.vehicleId, input.cityId), validateDriver(input.driverId, input.cityId)]);
  const points = await validatePoints(input.pointIds, input.cityId, schedule.type, schedule.universityId);
  return { schedule, points };
}

export async function createRoute(req, res) {
  const allowedCities = allowedCityIds(req);
  const cityId = parseId(req.body?.cityId) ?? req.user.cityId;
  const scheduleId = parseId(req.body?.scheduleId);
  const vehicleId = parseId(req.body?.vehicleId);
  const driverId = parseId(req.body?.driverId);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const pointIds = Array.isArray(req.body?.pointIds) ? req.body.pointIds.map(parseId).filter((id): id is number => Boolean(id)) : [];

  if (!cityId || !scheduleId || !name) return res.status(400).json({ error: "Nome, cidade e horário são obrigatórios" });

  try {
    const { points } = await validateRouteRelations({ cityId, scheduleId, vehicleId, driverId, pointIds }, allowedCities);
    const route = await prisma.transportRoute.create({
      data: {
        name,
        cityId,
        scheduleId,
        vehicleId: vehicleId ?? undefined,
        driverId: driverId ?? undefined,
        active: req.body?.active !== false,
        points: points.length ? { create: points.map((pickupPointId, index) => ({ pickupPointId, order: index + 1 })) } : undefined,
      },
      include: routeInclude,
    });

    await createAuditLog({
      userId: req.user.id,
      cityId: req.user.cityId,
      action: "create",
      entity: "TransportRoute",
      entityId: route.id,
      description: "Rota cadastrada",
      metadata: { routeCityId: cityId, scheduleId, vehicleId, driverId, pointIds: points },
      ...getRequestAuditData(req, res),
    });
    return res.status(201).json(route);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Não foi possível criar a rota" });
  }
}

export async function updateRoute(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const allowedCities = allowedCityIds(req);

  const current = await prisma.transportRoute.findUnique({
    where: { id },
    include: { points: { select: { pickupPointId: true } } },
  });
  if (!current || !allowedCities.includes(current.cityId)) return res.status(404).json({ error: "Rota não encontrada" });

  const cityId = req.body?.cityId === undefined ? current.cityId : parseId(req.body.cityId);
  const scheduleId = req.body?.scheduleId === undefined ? current.scheduleId : parseId(req.body.scheduleId);
  const vehicleId = req.body?.vehicleId === undefined ? current.vehicleId : parseId(req.body.vehicleId);
  const driverId = req.body?.driverId === undefined ? current.driverId : parseId(req.body.driverId);
  const pointIds = req.body?.pointIds === undefined
    ? current.points.map((point) => point.pickupPointId)
    : Array.isArray(req.body.pointIds)
      ? req.body.pointIds.map(parseId).filter((pointId): pointId is number => Boolean(pointId))
      : [];

  if (!cityId || !scheduleId) return res.status(400).json({ error: "Cidade e horário são obrigatórios" });

  try {
    const { points } = await validateRouteRelations({ cityId, scheduleId, vehicleId, driverId, pointIds }, allowedCities);
    const data: Prisma.TransportRouteUpdateInput = {
      name: req.body?.name === undefined ? undefined : String(req.body.name).trim(),
      city: { connect: { id: cityId } },
      schedule: { connect: { id: scheduleId } },
      vehicle: vehicleId ? { connect: { id: vehicleId } } : { disconnect: true },
      driver: driverId ? { connect: { id: driverId } } : { disconnect: true },
      active: req.body?.active,
    };

    const route = await prisma.$transaction(async (tx) => {
      await tx.transportRoute.update({ where: { id }, data });
      if (req.body?.pointIds !== undefined) {
        await tx.routePoint.deleteMany({ where: { routeId: id } });
        if (points.length) {
          await tx.routePoint.createMany({ data: points.map((pickupPointId, index) => ({ routeId: id, pickupPointId, order: index + 1 })) });
        }
      }
      return tx.transportRoute.findUniqueOrThrow({ where: { id }, include: routeInclude });
    });

    await createAuditLog({
      userId: req.user.id,
      cityId: req.user.cityId,
      action: "update",
      entity: "TransportRoute",
      entityId: id,
      description: "Rota atualizada",
      metadata: { routeCityId: cityId, scheduleId, vehicleId, driverId, pointIds: points },
      ...getRequestAuditData(req, res),
    });
    return res.json(route);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Não foi possível atualizar a rota" });
  }
}
